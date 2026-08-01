// npc-engine.js — Điều phối Công Cụ Nhân Vật: trích xuất, hoạt động ngầm, chèn ràng buộc, bám sự kiện
window.NPC_ENGINE = (function() {
  const INJECTION_NAME = 'npc_engine_context';

  let running = false;
  let runningLabel = '';
  let abortController = null;
  let lastDebug = { prompt: '', apiResponse: '', parsed: null, error: '' };
  // Số liệu khối chèn lần gần nhất, để tab Gỡ Lỗi cho biết đang tốn bao nhiêu ký tự.
  let lastInjectionInfo = { length: 0, blocks: 0, dropped: 0, maxChars: 0 };

  // Chống chạy hai lần cho cùng một tin nhắn. Có hai đường dẫn tới cùng một luồng:
  // Công Cụ Thế Giới gọi sang sau khi suy diễn xong (đường chính), và bộ hẹn giờ riêng bên dưới
  // (đường dự phòng). Đường nào chạy trước thì ghi khoá tin nhắn vào đây, đường kia thấy trùng là bỏ qua.
  let lastProcessedKey = '';
  let autoTimer = null;
  let autoRetries = 0;
  const AUTO_DELAY_MS = 3000;      // đủ dài để Công Cụ Thế Giới (1500ms) khởi động trước
  const AUTO_RETRY_MS = 2500;
  const AUTO_MAX_RETRIES = 12;     // ~30 giây chờ Công Cụ Thế Giới gọi API xong

  const data = () => window.NPC_ENGINE_DATA;
  const settings = force => window.NPC_ENGINE_SETTINGS?.getSettings(force) || {};
  const core = () => window.WORLD_ENGINE_CORE;

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const clean = value => String(value == null ? '' : value).trim();
  const normalized = value => clean(value).toLocaleLowerCase();
  const asArray = value => Array.isArray(value) ? value : [];
  // Number(null) === 0 chứ không phải NaN, nên bản cũ biến "không có tầng" thành "tầng 0".
  const asLayer = value => (value === null || value === undefined || value === '')
    ? null
    : (Number.isFinite(Number(value)) ? Number(value) : null);

  function describePath(path) {
    const parts = asArray(path).map(clean).filter(Boolean);
    return parts.length ? parts.join(' › ') : 'chưa rõ';
  }

  // Báo trạng thái ra quả cầu nổi và thanh trên cùng, dùng chung đường của Công Cụ Thế Giới.
  // Không có phần này thì engine là hộp đen: người dùng không biết nó đang chạy, đã xong,
  // hay đã bỏ qua vì lý do gì — mọi trục trặc đều trông giống nhau là "không thấy gì cả".
  function setStatus(text, isError) {
    const message = '[Nhân Vật] ' + clean(text);
    try { window.__WE_SetExternalStatus?.(message, !!isError); } catch (error) { /* không có UI thì thôi */ }
    if (isError) console.warn('[Công Cụ Nhân Vật] ' + clean(text));
    else console.log('[Công Cụ Nhân Vật] ' + clean(text));
  }

  // Báo cho quả cầu nổi biết trạng thái chạy vừa đổi, để nó vẽ lại hoạt ảnh xoay và nút dừng.
  // Chỉ hiện thông báo chữ là không đủ: người dùng không nhìn banner sẽ tưởng engine chết.
  function notifyBusyChanged() {
    try { window.WORLD_ENGINE_UI?.refreshBallControls?.(); }
    catch (error) { /* giao diện chưa sẵn sàng thì bỏ qua */ }
  }

  const SKIP_REASONS = {
    disabled: 'Công Cụ Nhân Vật đang tắt',
    running: 'đã có tác vụ đang chạy, bỏ qua lượt này',
    manual: 'đang ở chế độ thủ công'
  };

  // ================= Gộp kết quả trích xuất =================
  // Tách riêng khỏi phần gọi API để kiểm thử được mà không cần mạng.

  function mergeExtraction(state, parsed, layer) {
    const result = { added: [], updated: [], deaths: [], facts: [] };
    if (!parsed || typeof parsed !== 'object') return result;

    const st = settings();
    const currentLayer = asLayer(layer);
    const presentNames = new Set(asArray(parsed.scene?.presentNames).map(normalized));
    const presentIds = [];

    for (const incoming of asArray(parsed.npcs)) {
      const name = clean(incoming?.name);
      if (!name) continue;

      const existing = data().findNpc(state, name);
      const isNew = !existing;

      // Prompt dặn mô hình chỉ ghi phần THAY ĐỔI, nên nhân vật cũ thường về mà không kèm
      // significance hay tier. Trước đây chỗ này quy về 0 rồi ghi đè, khiến nhân vật chính bị
      // xoá điểm ngay lượt sau khi tái xuất hiện và tụt luôn xuống ngoại vi.
      // Nguyên tắc: KHÔNG có trong phản hồi thì GIỮ NGUYÊN, không phải đặt về mặc định.
      const rawSignificance = incoming.significance;
      const hasSignificance = rawSignificance !== undefined && rawSignificance !== null
        && rawSignificance !== '' && Number.isFinite(Number(rawSignificance));
      const significance = hasSignificance
        ? Math.min(100, Math.max(0, parseInt(rawSignificance)))
        : (parseInt(existing?.significance) || 0);

      // Bậc do mô hình đề xuất vẫn phải qua ngưỡng cấu hình — không phó mặc mô hình tự quyết,
      // vì tiêu chuẩn của nó trôi dần qua các lượt.
      const proposedTier = (incoming.tier === 'core' || incoming.tier === 'peripheral') ? incoming.tier : null;
      let tier;
      if (existing?.pinned) {
        tier = existing.tier;                                   // ghim tay thì mô hình không đụng tới được
      } else if (proposedTier === 'core') {
        tier = significance >= st.significanceThreshold ? 'core' : 'peripheral';
      } else if (proposedTier === 'peripheral') {
        tier = 'peripheral';
      } else {
        tier = existing?.tier || 'peripheral';                   // không nói gì thì giữ nguyên bậc cũ
      }

      const patch = {
        name,
        // Biệt danh cũng cộng dồn: lượt sau mô hình chỉ nêu biệt danh mới, ghi đè sẽ mất tên cũ.
        aliases: [...asArray(existing?.aliases), ...asArray(incoming.aliases)],
        significance,
        tier,
        lastSeenLayer: currentLayer,
        firstSeenLayer: existing?.firstSeenLayer ?? currentLayer
      };

      if (incoming.location?.path) {
        patch.location = {
          ...(existing?.location || {}),
          path: asArray(incoming.location.path).map(clean).filter(Boolean)
        };
        // Nhân vật xuất hiện trước mặt người chơi thì sương mù vị trí tan: hai giá trị khớp lại.
        if (incoming.present) {
          patch.location.userBelievesAt = describePath(patch.location.path);
          patch.location.fogSince = null;
          patch.location.movingTo = null;
          patch.location.etaRounds = 0;
        }
      }
      if (incoming.goals) patch.goals = asArray(incoming.goals);
      if (incoming.faction) patch.faction = incoming.faction;
      if (incoming.status) patch.status = { ...(existing?.status || {}), ...incoming.status };

      if (incoming.relations) {
        patch.relations = {
          user: incoming.relations.user
            ? {
                attitude: clean(incoming.relations.user.attitude),
                trust: parseInt(incoming.relations.user.trust) || 0,
                lastChangeReason: clean(incoming.relations.user.reason || incoming.relations.user.lastChangeReason)
              }
            : (existing?.relations?.user || { attitude: '', trust: 0, lastChangeReason: '' }),
          npcs: incoming.relations.npcs ? asArray(incoming.relations.npcs) : asArray(existing?.relations?.npcs)
        };
      }

      const npc = data().upsertNpc(state, { ...patch, id: existing?.id });

      // Nhân dạng: chỉ điền vào ô trống, không bao giờ ghi đè ô đã chốt.
      data().mergeIdentity(npc, incoming.identity);

      // Tri thức là trường cộng dồn: nối thêm và đóng dấu tầng, không ghi đè.
      for (const item of asArray(incoming.knowledge)) {
        const fact = clean(item?.fact);
        if (!fact) continue;
        if (npc.knowledge.some(known => normalized(known.fact) === normalized(fact))) continue;
        npc.knowledge.push({
          fact,
          source: clean(item.source) || 'chứng kiến',
          certainty: clean(item.certainty) || 'chắc chắn',
          layer: currentLayer,
          factId: clean(item.factId) || null
        });
      }

      if (incoming.present || presentNames.has(normalized(name))) presentIds.push(npc.id);
      (isNew ? result.added : result.updated).push(npc.id);
    }

    // Cái chết là chuyện thiên hạ CÓ THỂ biết, nhưng chưa chắc đã biết — nên vừa lưu kho vừa
    // ghi thành một sự thật công khai để ràng buộc tri thức còn chỗ mà trừ.
    for (const death of asArray(parsed.deaths)) {
      const name = clean(death?.name);
      if (!name) continue;
      const npc = data().findNpc(state, name);
      if (!npc || npc.tier !== 'core') continue;
      data().archiveNpc(state, name, clean(death.reason), currentLayer);
      // Cái chết diễn ra trước mặt người chơi thì đã là chính văn rồi, thừa nhận ngay.
      const fact = addPublicFact(state, `${name} đã chết${death.reason ? ' (' + clean(death.reason) + ')' : ''}`,
        currentLayer, 'death', { acknowledged: true });
      result.deaths.push(npc.id);
      result.facts.push(fact.id);
      // Người chứng kiến cái chết thì đương nhiên đã biết.
      for (const witnessId of presentIds) {
        const witness = state.npcs.find(item => item.id === witnessId);
        if (witness) witness.knowledge.push({ fact: fact.text, source: 'chứng kiến', certainty: 'chắc chắn', layer: currentLayer, factId: fact.id });
      }
    }

    state.scene = {
      layer: currentLayer,
      location: asArray(parsed.scene?.location).map(clean).filter(Boolean),
      presentIds
    };

    data().enforceCoreLimit(state, st.npcCoreLimit);
    return result;
  }

  function nextFactId(state) {
    const used = asArray(state.publicFacts)
      .map(fact => parseInt(String(fact.id).replace(/^fact:/, '')))
      .filter(Number.isFinite);
    return 'fact:' + ((used.length ? Math.max(...used) : 0) + 1);
  }

  // Sự việc xảy ra ở hậu trường KHÁC với sự việc trong truyện đã biết.
  // Một chuyện engine suy diễn ra mà chưa từng được viết vào chính văn thì người chơi chưa đọc thấy,
  // nhân vật trong truyện cũng chưa có đường nào biết được. Nó chỉ trở thành "chuyện của thiên hạ"
  // khi AI chính thật sự kể ra, hoặc để lại dấu vết cảm nhận được.
  //
  // acknowledged = false: mới có ở hậu trường, dùng làm chất liệu cho AI viết.
  // acknowledged = true : đã vào chính văn, từ đây mới tính vào ràng buộc tri thức.
  function addPublicFact(state, text, layer, kind, options) {
    const existing = state.publicFacts.find(fact => normalized(fact.text) === normalized(text));
    if (existing) {
      if (options?.acknowledged === true) existing.acknowledged = true;
      return existing;
    }
    const fact = {
      id: nextFactId(state),
      text: clean(text),
      layer: asLayer(layer),
      kind: clean(kind) || 'sự kiện',
      // Chuyện diễn ra ngay trước mặt người chơi thì đã là chính văn rồi, thừa nhận luôn.
      acknowledged: options?.acknowledged === true
    };
    state.publicFacts.push(fact);
    return fact;
  }

  // Đánh dấu những sự việc hậu trường vừa được AI chính kể vào chính văn.
  // Danh sách id do pha trích xuất của lượt kế tiếp báo về.
  function acknowledgeFacts(state, ids) {
    const wanted = new Set(asArray(ids).map(clean).filter(Boolean));
    if (!wanted.size) return [];
    const done = [];
    for (const fact of asArray(state.publicFacts)) {
      if (!wanted.has(fact.id) || fact.acknowledged) continue;
      fact.acknowledged = true;
      done.push(fact.id);
    }
    // Tin đồn và nhật ký hoạt động ngầm gắn với sự việc đó cũng được thừa nhận theo.
    for (const rumor of asArray(state.rumorQueue)) {
      if (wanted.has(rumor.factId)) rumor.acknowledged = true;
    }
    for (const npc of state.npcs) {
      for (const entry of asArray(npc.offscreenLog)) {
        if (wanted.has(entry.factId)) entry.acknowledged = true;
      }
    }
    return done;
  }

  // ================= Gộp kết quả hoạt động ngầm =================

  function applyOffscreen(state, parsed, layer) {
    const result = { acted: [], rumors: [], moves: [] };
    if (!parsed || typeof parsed !== 'object') return result;

    const currentLayer = asLayer(layer);

    for (const activity of asArray(parsed.activities)) {
      const npc = data().findNpc(state, activity?.name);
      if (!npc || npc.status.archived || npc.status.alive === false) continue;

      const action = clean(activity.action);
      if (action) {
        npc.offscreenLog.push({
          layer: currentLayer,
          round: state.round,
          action,
          timeRef: clean(activity.timeRef),
          visibility: clean(activity.visibility) || 'kín đáo',
          becameRumor: activity.becameRumor === true
        });
        result.acted.push(npc.id);
      }

      const destination = asArray(activity.move?.to).map(clean).filter(Boolean);
      if (destination.length) {
        const eta = Math.max(0, parseInt(activity.move.etaRounds) || 0);
        const travelMode = clean(activity.move.travelMode);
        if (eta > 0) {
          npc.location.movingTo = destination;
          npc.location.etaRounds = eta;
          npc.location.travelMode = travelMode;
          // Người chơi không đi cùng thì không biết nhân vật đã rời đi — sương mù bắt đầu từ đây.
          if (!npc.location.fogSince) npc.location.fogSince = currentLayer;
        } else {
          npc.location.path = destination;
          npc.location.movingTo = null;
          npc.location.etaRounds = 0;
        }
        if (settings().travelCacheEnabled) {
          const from = describePath(npc.location.path);
          const to = describePath(destination);
          if (from !== to && !data().getTravel(state, from, to)) {
            data().setTravel(state, from, to, { etaRounds: eta, travelMode, updatedRound: state.round });
          }
        }
        result.moves.push(npc.id);
      }

      if (activity.intent?.action) {
        npc.pendingIntent = {
          action: clean(activity.intent.action),
          etaRounds: Math.max(0, parseInt(activity.intent.etaRounds) || 0),
          layer: currentLayer,
          storyDay: asLayer(core()?.getLastStoryDay?.())
        };
      }

      for (const item of asArray(activity.knowledgeGained)) {
        const fact = clean(item?.fact);
        if (!fact) continue;
        if (npc.knowledge.some(known => normalized(known.fact) === normalized(fact))) continue;
        npc.knowledge.push({
          fact,
          source: clean(item.source) || 'suy đoán',
          certainty: clean(item.certainty) || 'mơ hồ',
          layer: currentLayer,
          factId: null
        });
      }

      if (activity.becameRumor === true) {
        const text = clean(activity.rumorText) || action;
        if (text) {
          const fact = addPublicFact(state, text, currentLayer, 'tin đồn');
          state.rumorQueue.push({ text, layer: currentLayer, sourceId: npc.id, factId: fact.id, acknowledged: false });
          // Gắn nhật ký với sự việc, để khi được thừa nhận thì cả hai cùng đổi trạng thái.
          const entry = npc.offscreenLog[npc.offscreenLog.length - 1];
          if (entry) entry.factId = fact.id;
          result.rumors.push(text);
        }
      }
    }

    return result;
  }

  // ================= Khối chèn vào prompt =================
  // Hàm thuần: (state, settings, ngữ cảnh) → chuỗi. Không đụng DOM, không gọi API — kiểm thử được trọn vẹn.

  function buildTimeAnchor(state, context) {
    const bits = [];
    const storyDay = context?.storyDay;
    if (Number.isFinite(Number(storyDay))) bits.push(`ngày truyện thứ ${Number(storyDay)}`);
    bits.push(`lượt thứ ${state.round}`);

    const recent = state.npcs
      .flatMap(npc => npc.offscreenLog.map(entry => ({ ...entry, name: npc.name })))
      .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0))
      .slice(0, 3)
      .map(entry => `${entry.name}: ${entry.action}`);

    let text = `【Neo thời gian】${bits.join(' · ')}`;
    if (recent.length) text += `\nDiễn biến nền gần đây: ${recent.join('; ')}`;
    return text;
  }

  function buildLocationBlock(state, st) {
    const mode = st.locationFogMode;
    const lines = [];

    for (const npc of state.npcs) {
      if (npc.tier !== 'core' || npc.status.archived) continue;

      const real = describePath(npc.location.path);
      const believed = clean(npc.location.userBelievesAt);
      const inTransit = npc.location.movingTo && npc.location.etaRounds > 0;

      if (mode === 'off') {
        let line = `${npc.name}: đang ở ${real}`;
        if (inTransit) {
          line += `, đang trên đường tới ${describePath(npc.location.movingTo)}, còn ${npc.location.etaRounds} lượt nữa mới tới`;
        }
        lines.push(line);
        continue;
      }

      // Che vị trí thật: chỉ nói chỗ người chơi tưởng, để mô hình không lỡ miệng tiết lộ thứ nó không nên biết.
      const shown = believed || real;
      const diverged = believed && believed !== real;

      if (mode === 'strict') {
        lines.push(`${npc.name}: lần cuối được biết là ở ${shown}`);
        continue;
      }

      let line = `${npc.name}: lần cuối được biết là ở ${shown}`;
      if (diverged || inTransit) {
        line += ' — có tin đồn nhân vật này không còn ở đó, nhưng chưa ai rõ hiện đang ở đâu';
      }
      lines.push(line);
    }

    if (!lines.length) return '';

    const constraints = state.npcs
      .filter(npc => npc.tier === 'core' && !npc.status.archived && npc.location.movingTo && npc.location.etaRounds > 0)
      .map(npc => `${npc.name} chưa thể có mặt ở ${describePath(npc.location.movingTo)} (còn ${npc.location.etaRounds} lượt)`);

    // Ràng buộc cứng đặt NGAY SAU tiêu đề, không phải cuối khối: khi bị cắt cho vừa trần độ dài,
    // phần cắt đi là từ dưới lên, nên thứ quan trọng nhất phải nằm trên cùng.
    const head = constraints.length ? `\nRàng buộc bắt buộc: ${constraints.join('; ')}` : '';
    return `【Vị trí nhân vật】${head}\n${lines.join('\n')}`;
  }

  // Nhân dạng của nhân vật đang có mặt: gửi cho AI chính để nó không viết sai giới tính, xưng hô,
  // chủng tộc hay độ tuổi. Rẻ về token mà chặn được loại lỗi người đọc nhận ra ngay.
  function buildIdentityBlock(state, st) {
    if (st.injectIdentity === false) return '';
    const scope = state.npcs.filter(npc => asArray(state.scene?.presentIds).includes(npc.id));
    const lines = scope.map(npc => {
      const text = data().describeIdentity(npc);
      return text ? `${npc.name}: ${text}` : '';
    }).filter(Boolean);
    if (!lines.length) return '';
    return `【Nhân dạng cố định】\n${lines.join('\n')}\nViết đúng giới tính, cách xưng hô và độ tuổi như trên. Đây là thiết lập đã chốt, không được đổi.`;
  }

  function buildKnowledgeBlock(state, st) {
    if (st.knowledgeInjectScope === 'none') return '';

    const scope = st.knowledgeInjectScope === 'all'
      ? state.npcs.filter(npc => npc.tier === 'core' && !npc.status.archived)
      : state.npcs.filter(npc => asArray(state.scene.presentIds).includes(npc.id));

    // Chỉ những sự việc ĐÃ VÀO CHÍNH VĂN mới tính. Chuyện engine suy diễn ra ở hậu trường mà chưa
    // ai kể thì chưa tồn tại trong truyện — ràng buộc "nhân vật chưa biết" về nó là vô nghĩa, mà
    // còn tệ hơn: nó tiết lộ cho AI chính một tình tiết lẽ ra vẫn đang giấu.
    const known = state.publicFacts.filter(fact => fact.acknowledged === true);
    if (!scope.length || !known.length) return '';

    const limit = Math.max(0, parseInt(st.knowledgeInjectLimit) || 0);
    const lines = [];

    for (const npc of scope) {
      const knownFactIds = new Set(npc.knowledge.map(item => item.factId).filter(Boolean));
      const knownTexts = new Set(npc.knowledge.map(item => normalized(item.fact)));

      const unknown = known
        .filter(fact => !knownFactIds.has(fact.id) && !knownTexts.has(normalized(fact.text)))
        .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0))
        .slice(0, limit)
        .map(fact => fact.text);

      if (unknown.length) lines.push(`${npc.name} CHƯA biết: ${unknown.join('; ')}`);
    }

    if (!lines.length) return '';
    return `【Ràng buộc tri thức】\n${lines.join('\n')}\nCác nhân vật trên không được nhắc tới, ám chỉ, hay phản ứng với những điều họ chưa biết.`;
  }

  function buildRumorBlock(state, st) {
    const limit = Math.max(1, parseInt(st.knowledgeInjectLimit) || 5);
    const sorted = asArray(state.rumorQueue).sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0)).slice(0, limit);
    if (!sorted.length) return '';

    // Tách hai loại: chuyện chưa ai kể là CHẤT LIỆU để AI dùng nếu muốn; chuyện đã kể rồi là
    // sự thật đã có trong truyện. Gộp chung thì AI không phân biệt được cái nào nó đã viết ra.
    const fresh = sorted.filter(item => item.acknowledged !== true).map(item => clean(item.text)).filter(Boolean);
    const settled = sorted.filter(item => item.acknowledged === true).map(item => clean(item.text)).filter(Boolean);

    const parts = [];
    if (fresh.length) {
      parts.push(`Chưa ai kể ra (chất liệu, dùng khi hợp cảnh):\n${fresh.map(text => '· ' + text).join('\n')}`);
    }
    if (settled.length) {
      parts.push(`Đã thành chuyện trong truyện:\n${settled.map(text => '· ' + text).join('\n')}`);
    }
    return `【Tin đồn】\n${parts.join('\n')}`;
  }

  const INJECTION_HEADER = '【TRẠNG THÁI NHÂN VẬT NỀN】';
  const INJECTION_FOOTER = 'Hãy tuân thủ đúng các ràng buộc trên. Không tự ý đổi vị trí nhân vật, không cho nhân vật biết điều họ chưa được biết.';

  function buildInjectionText(state, st, context) {
    if (!state || st.injectIntoPrompt === false) return '';

    // Xếp theo mức thiết yếu giảm dần: hết ngân sách thì bỏ từ dưới lên. Ràng buộc vị trí là thứ
    // AI dễ vi phạm nhất nên đứng trên; tin đồn chỉ là chất liệu trang trí nên xuống cuối.
    const ordered = [
      st.timeAnchorEnabled !== false ? buildTimeAnchor(state, context) : '',
      // Nhân dạng đứng ngay sau neo thời gian: ngắn nhất mà sai thì người đọc nhận ra ngay lập tức.
      buildIdentityBlock(state, st),
      st.injectLocation !== false ? buildLocationBlock(state, st) : '',
      st.injectKnowledge !== false ? buildKnowledgeBlock(state, st) : '',
      st.injectRumor !== false ? buildRumorBlock(state, st) : ''
    ].filter(Boolean);

    if (!ordered.length) return '';

    // Không có trần thì khối này phình theo số nhân vật nhân số sự kiện, và SillyTavern sẽ báo
    // "Mandatory prompts exceed the context size" vì phần chèn của extension tính vào prompt bắt buộc.
    const maxChars = Math.max(0, parseInt(st.injectMaxChars) || 0);
    const overhead = INJECTION_HEADER.length + INJECTION_FOOTER.length + 6;
    const budget = maxChars > 0 ? Math.max(0, maxChars - overhead) : Infinity;

    // Cắt một khối cho vừa chỗ trống, cắt theo ranh giới dòng để không đứt câu giữa chừng.
    // Giữ nguyên dòng tiêu đề của khối, vì mất tiêu đề thì phần còn lại mất ngữ cảnh.
    const fitBlock = (block, room) => {
      const lines = block.split('\n');
      const out = [];
      let size = 0;
      for (const line of lines) {
        const cost = line.length + (out.length ? 1 : 0);
        if (size + cost > room) break;
        out.push(line);
        size += cost;
      }
      return out.length > 1 ? out.join('\n') : '';
    };

    const kept = [];
    let used = 0;
    let dropped = 0;
    for (let i = 0; i < ordered.length; i++) {
      const block = ordered[i];
      const gap = kept.length ? 2 : 0;
      if (used + block.length + gap <= budget) {
        kept.push(block);
        used += block.length + gap;
        continue;
      }
      // Không vừa: cắt bớt khối này rồi DỪNG HẲN. Không được nhảy sang khối sau, vì các khối
      // xếp theo mức thiết yếu giảm dần — để tin đồn lọt vào trong khi ràng buộc vị trí bị bỏ
      // là giữ phần trang trí mà mất phần quan trọng nhất.
      const trimmed = fitBlock(block, Math.max(0, budget - used - gap));
      if (trimmed) { kept.push(trimmed); used += trimmed.length + gap; }
      dropped += ordered.length - i - (trimmed ? 0 : 1);
      break;
    }

    // Ngân sách quá chặt tới mức không giữ nổi khối nào: giữ khối đầu và cắt cứng,
    // vì mất ràng buộc hoàn toàn còn tệ hơn ràng buộc bị cắt cụt.
    if (!kept.length) kept.push(ordered[0].slice(0, Math.max(0, budget)));

    let text = `${INJECTION_HEADER}\n${kept.join('\n\n')}\n\n${INJECTION_FOOTER}`;
    if (maxChars > 0 && text.length > maxChars) text = text.slice(0, maxChars);
    lastInjectionInfo = { length: text.length, blocks: kept.length, dropped, maxChars };
    return text;
  }

  // ================= Chèn =================

  function unregisterInjection() {
    const ctx = window.SillyTavern?.getContext?.();
    if (typeof ctx?.setExtensionPrompt === 'function') ctx.setExtensionPrompt(INJECTION_NAME, '', 1, 1);
  }

  function applyInjection(stateOverride) {
    const st = settings(true);
    if (st.engineEnabled === false || st.injectIntoPrompt === false) {
      unregisterInjection();
      return '';
    }
    const state = stateOverride || data().loadState();
    const content = buildInjectionText(state, st, { storyDay: core()?.getLastStoryDay?.() });
    const ctx = window.SillyTavern?.getContext?.();
    if (typeof ctx?.setExtensionPrompt === 'function') ctx.setExtensionPrompt(INJECTION_NAME, content, 1, 1);
    return content;
  }

  // ================= Nối ngược sang Công Cụ Thế Giới =================
  // Gọi từ world-engine-evolution.js khi ráp prompt suy diễn thế giới.

  function buildWorldEngineContext(worldState) {
    const st = settings();
    if (st.injectIntoWorldEngine === false) return '';

    const state = data().loadState();
    const limit = Math.max(0, parseInt(st.worldEngineNpcLimit) || 0);
    if (!limit) return '';

    const lines = state.npcs
      .filter(npc => npc.tier === 'core' && !npc.status.archived)
      .sort((a, b) => (b.significance || 0) - (a.significance || 0))
      .slice(0, limit)
      .map(npc => {
        const bits = [`${npc.name} (${describePath(npc.location.path)})`];
        if (npc.faction?.name) bits.push(`thuộc ${npc.faction.name}`);
        const goal = asArray(npc.goals)[0];
        if (goal?.text) bits.push(`đang: ${clean(goal.text)}`);
        if (npc.pendingIntent?.action) bits.push(`dự định: ${clean(npc.pendingIntent.action)}`);
        return '· ' + bits.join(' — ');
      });

    if (!lines.length) return '';
    return `【NHÂN VẬT TRỌNG YẾU VÀ DỰ ĐỊNH CỦA HỌ】\n${lines.join('\n')}`;
  }

  // ================= Gọi API =================

  // Tham số đầu của callApi phải là CHUỖI: bên trong nó tự bọc thành [{ role: 'user', content: prompt }].
  // Truyền mảng messages vào sẽ khiến content thành mảng object và API trả HTTP 400
  // ("at least one contents field is required").
  async function callModel(prompt, st) {
    if (typeof prompt !== 'string') {
      throw new Error('Prompt gửi cho API phải là chuỗi, nhận được: ' + typeof prompt);
    }
    const retries = Math.max(0, Number(st.apiAutoRetries) || 0);
    lastDebug = { prompt, apiResponse: '', parsed: null, error: '' };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await window.WORLD_ENGINE_API.callApi(
          prompt, st.maxTokens, st.temperature, abortController?.signal, st
        );
        lastDebug.apiResponse = raw;
        const parsed = window.WORLD_ENGINE_API.parseJSON(raw);
        lastDebug.parsed = clone(parsed);
        return parsed;
      } catch (error) {
        lastDebug.error = String(error?.message || error);
        if (abortController?.signal?.aborted || attempt >= retries) throw error;
      }
    }
    throw new Error('Yêu cầu API nhân vật thất bại');
  }

  // Đọc các mục Sổ Tay Thế Giới đã chọn, theo phạm vi riêng 'npc'.
  // Mục 🔵 thường trực thì luôn vào; mục 🟢 từ khoá chỉ vào khi văn bản quét có nhắc tới —
  // nên gọi hàm này với văn bản quét khác nhau ở mỗi pha sẽ ra tư liệu khác nhau, đúng như mong muốn.
  async function buildWorldbookSection(scanText, st) {
    if (st.worldbookEnabled === false) return '';
    try {
      return await window.WORLD_ENGINE_WORLDBOOK?.buildPromptSection?.(clean(scanText), 'npc') || '';
    } catch (error) {
      console.error('[Công Cụ Nhân Vật] Đọc Sổ Tay Thế Giới thất bại (đã cách ly)', error);
      return '';
    }
  }

  // Văn bản quét cho pha hoạt động ngầm. Hội thoại lượt này gần như vô dụng ở đây: NPC đang vắng mặt
  // nên tên họ, nơi họ ở và mục tiêu họ đuổi theo mới là thứ cần khớp từ khoá. Nhờ vậy nhân vật đang
  // trên đường tới Trường An sẽ kéo được mục lorebook về Trường An, dù cả lượt không ai nhắc tới nó.
  function offscreenScanText(absent, worldDigest) {
    const parts = [clean(worldDigest)];
    for (const npc of absent) {
      parts.push(clean(npc.name));
      parts.push(...asArray(npc.aliases).map(clean));
      parts.push(describePath(npc.location?.path));
      if (npc.location?.movingTo) parts.push(describePath(npc.location.movingTo));
      if (npc.faction?.name) parts.push(clean(npc.faction.name));
      for (const goal of asArray(npc.goals)) parts.push(clean(goal?.text));
      if (npc.pendingIntent?.action) parts.push(clean(npc.pendingIntent.action));
    }
    return parts.filter(Boolean).join('\n');
  }

  // ================= Luồng chính =================
  // Gọi từ world-engine.js sau khi suy diễn thế giới hoàn tất. Thứ tự: thế giới xong → nhân vật chạy,
  // nên hoạt động ngầm của lượt này phản ứng được với diễn biến thế giới vừa sinh ra trong chính lượt này.

  async function ingestWorldEvolution(payload) {
    const st = settings(true);
    if (st.engineEnabled === false) {
      setStatus(SKIP_REASONS.disabled);
      return { skipped: true, reason: 'disabled', message: SKIP_REASONS.disabled };
    }
    if (running) {
      // Bỏ qua chứ không phải thất bại: một tác vụ khác đang chạy và sẽ hoàn tất bình thường.
      return { skipped: true, reason: 'running', message: SKIP_REASONS.running };
    }

    const layer = asLayer(payload?.layer) ?? core()?.getChatLayer?.() ?? null;
    const replace = payload?.replace === true;

    running = true;
    runningLabel = 'Trích xuất nhân vật';
    abortController = new AbortController();
    notifyBusyChanged();
    setStatus('Đang trích xuất nhân vật...');

    try {
      // Reroll (replace=true) thì dựng lại từ điểm lưu, để lần sinh mới không chồng lên lần sinh cũ.
      const base = replace ? (data().loadCheckpoint() || data().loadState()) : data().loadState();
      if (!replace) data().saveCheckpoint(base);

      const state = clone(base);
      state.round = Math.max(0, (parseInt(state.round) || 0) + (replace ? 0 : 1));
      state.chatLayer = layer;
      state.worldLink = {
        lastWorldRound: parseInt(payload?.worldRound) || state.worldLink.lastWorldRound,
        lastDigest: clean(payload?.worldDigest)
      };

      const arrived = data().tickTravel(state);
      const previousTime = state.storyTime || {};

      // Sổ Tay Thế Giới: các mục người dùng đã chọn ở tab Worldbook, phạm vi lưu riêng của engine này.
      // Mục kiểu từ khoá chỉ bật khi văn bản quét có nhắc tới, nên hai pha cần hai văn bản quét khác nhau
      // (xem buildWorldbookSection). Cách ly lỗi: lorebook hỏng thì hai pha vẫn phải chạy.
      const worldbook = await buildWorldbookSection(
        clean(payload?.dialogue) + '\n' + clean(payload?.worldDigest), st
      );

      // --- Pha 1: trích xuất nhân vật từ hội thoại ---
      const extraction = await callModel(window.NPC_ENGINE_PROMPT.buildPrompt({
        npcs: state.npcs,
        knownLimit: st.npcCoreLimit * 2,
        dialogue: clean(payload?.dialogue),
        worldDigest: clean(payload?.worldDigest),
        worldbook,
        tonePrompt: st.tonePrompt,
        nameBlacklist: st.nameBlacklist,
        previousTimeLabel: previousTime.label,
        pendingFacts: asArray(state.publicFacts).filter(fact => fact.acknowledged !== true).slice(-12),
        storyDay: asLayer(state.lastStoryDay)
      }), st);
      const merged = mergeExtraction(state, extraction, layer);

      // Sự việc hậu trường vừa được AI chính kể ra thì từ đây mới tính là chuyện trong truyện.
      const acknowledged = acknowledgeFacts(state, extraction?.acknowledgedFacts);

      // Đọc thời gian PHẢI làm sau trích xuất, vì chính mô hình là thứ đọc ra nó từ chính văn.
      const time = readStoryTime(state, extraction);

      // Đếm ngược dự định đang treo: còn hạn → đến hạn → quá hạn thì bỏ.
      const intents = data().tickIntents(state, time.day);

      // --- Pha 2: hoạt động ngầm cho NPC trọng yếu đang vắng mặt ---
      let offscreen = { acted: [], rumors: [], moves: [] };
      const absent = state.npcs.filter(npc =>
        npc.tier === 'core' &&
        !npc.status.archived &&
        npc.status.alive !== false &&
        !asArray(state.scene.presentIds).includes(npc.id));

      if (st.offscreenEnabled !== false && absent.length) {
        runningLabel = 'Suy diễn hoạt động ngầm';
        setStatus(`Đang suy diễn hoạt động ngầm cho ${absent.length} nhân vật vắng mặt...`);
        const activities = await callModel(window.NPC_ENGINE_OFFSCREEN.buildPrompt({
          absentNpcs: absent,
          worldDigest: clean(payload?.worldDigest),
          worldbook: await buildWorldbookSection(offscreenScanText(absent, payload?.worldDigest), st),
          sceneSummary: describePath(state.scene.location),
          travelCache: state.travelCache,
          worldScale: st.worldScale,
          elapsedDays: time.elapsed,
          timeLabel: time.label,
          previousTimeLabel: previousTime.label,
          dueIntentIds: intents.due,
          aggressiveness: st.offscreenAggressiveness,
          maxActivities: st.offscreenMaxPerRound,
          storyDay: time.day
        }), st);
        offscreen = applyOffscreen(state, activities, layer);
      }

      data().saveState(state);
      applyInjection(state);

      // Đánh dấu tin nhắn này đã xử lý, để đường chạy còn lại không làm lại lần nữa.
      {
        const ctx = window.SillyTavern?.getContext?.();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        if (ctx && lastMsg && !lastMsg.is_user) lastProcessedKey = messageKeyOf(ctx, chat, lastMsg);
      }
      clearAutoTimer();

      // Làm mới bảng điều khiển ngay, nếu không người dùng phải đóng rồi mở lại mới thấy kết quả.
      try { window.WORLD_ENGINE_UI?.refresh?.(true); }
      catch (error) { console.warn('[Công Cụ Nhân Vật] Làm mới giao diện thất bại (đã cách ly)', error); }

      const core_ = state.npcs.filter(npc => npc.tier === 'core').length;
      const summary = [
        `${merged.added.length} mới`,
        `${merged.updated.length} cập nhật`,
        `${core_} trọng yếu`,
        offscreen.acted.length ? `${offscreen.acted.length} hoạt động ngầm` : '',
        offscreen.rumors.length ? `${offscreen.rumors.length} tin đồn` : '',
        acknowledged.length ? `${acknowledged.length} chuyện vào truyện` : '',
        merged.deaths.length ? `${merged.deaths.length} qua đời` : ''
      ].filter(Boolean).join(' · ');
      setStatus('Hoàn tất — ' + summary);

      return {
        skipped: false,
        arrived,
        added: merged.added,
        updated: merged.updated,
        deaths: merged.deaths,
        acted: offscreen.acted,
        rumors: offscreen.rumors,
        message: summary
      };
    } catch (error) {
      setStatus('Thất bại: ' + (error?.message || error), true);
      throw error;
    } finally {
      running = false;
      runningLabel = '';
      abortController = null;
      notifyBusyChanged();
    }
  }

  // ================= Chạy tự động độc lập =================
  // Trước đây engine này không có lịch chạy riêng, chỉ bám vào performEvolution của Công Cụ Thế Giới.
  // Hệ quả: Thế Giới để chế độ thủ công, hoặc suy diễn cách quãng, hoặc bị tắt, hoặc lượt đó suy diễn
  // thất bại — thì hồ sơ nhân vật đứng im mà không báo gì. Nay có bộ hẹn giờ riêng làm đường dự phòng.

  function messageKeyOf(ctx, chat, message) {
    const messageId = message?.mesId ?? message?.message_id ?? message?.send_date ?? (chat.length - 1);
    const swipeId = message?.swipe_id ?? message?.swipeId ?? '';
    return [core()?.getChatId?.() || 'default', chat.length - 1, messageId, swipeId].join('|');
  }

  function clearAutoTimer() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  }

  // Ghép hội thoại gần nhất để trích xuất. Lấy từ cuối chat ngược lên, bỏ tin nhắn rỗng.
  function buildDialogueText(chat, rounds) {
    const wanted = Math.max(1, parseInt(rounds) || 1) * 2;
    return asArray(chat).slice(-wanted)
      .map(message => `${message?.is_user ? 'Người chơi' : (clean(message?.name) || 'Nhân vật')}: ${clean(message?.mes)}`)
      .filter(line => line.split(': ').slice(1).join(': ').length > 0)
      .join('\n');
  }

  async function runAutoExtraction(expectedKey) {
    autoTimer = null;
    const st = settings(true);
    if (st.engineEnabled === false || st.evolveMode === 'manual') return;

    // Đang có tác vụ chạy (thường là đường Thế Giới gọi sang): hẹn lại chứ không bỏ cuộc.
    // Bỏ cuộc ở đây thì nếu tác vụ kia thất bại giữa chừng, lượt này mất luôn mà không ai biết.
    if (running) {
      if (autoRetries < AUTO_MAX_RETRIES) {
        autoRetries += 1;
        autoTimer = setTimeout(() => runAutoExtraction(expectedKey), AUTO_RETRY_MS);
      }
      return;
    }

    const ctx = window.SillyTavern?.getContext?.();
    const chat = ctx?.chat || [];
    const lastMsg = chat[chat.length - 1];
    if (!ctx || !lastMsg || lastMsg.is_user || !clean(lastMsg.mes)) return;
    if (messageKeyOf(ctx, chat, lastMsg) !== expectedKey) return;

    // Đường chính đã xử lý tin nhắn này rồi thì thôi.
    if (lastProcessedKey === expectedKey) return;

    // Công Cụ Thế Giới đang gọi API: chờ nó xong đã, vì hoạt động ngầm cần worldDigest của lượt này.
    // Hết số lần chờ mà nó vẫn chạy thì tự chạy luôn với tóm tắt cũ, còn hơn là đứng im.
    const worldBusy = window.WORLD_ENGINE_EVOLUTION?.isRunning?.() === true;
    if (worldBusy && autoRetries < AUTO_MAX_RETRIES) {
      autoRetries += 1;
      autoTimer = setTimeout(() => runAutoExtraction(expectedKey), AUTO_RETRY_MS);
      return;
    }
    autoRetries = 0;

    const worldState = core()?.loadState?.() || {};
    const layer = core()?.getChatLayer?.();

    // Reroll hoặc sửa rồi gửi lại: tầng này đã xử lý rồi, phải dựng lại từ điểm lưu chứ không nối
    // thêm — nếu không, nhân vật của lần sinh bị bỏ vẫn nằm nguyên trong hồ sơ.
    //
    // Ở đây so sánh số tầng là AN TOÀN, khác với trường hợp của Công Cụ Thế Giới: hàm này chạy sau
    // GENERATION_ENDED nên tin nhắn đã nằm trong chat rồi. Chỗ từng gây hồi quy ở v2.3.18 là
    // GENERATION_STARTED, phát ra TRƯỚC khi tầng được đẩy vào chat.
    const npcState = data().loadState();
    const stateLayer = asLayer(npcState.chatLayer);
    const replace = stateLayer !== null && asLayer(layer) !== null && Number(layer) <= stateLayer;

    try {
      await ingestWorldEvolution({
        layer,
        worldRound: worldState.round,
        worldDigest: worldState.worldDigest,
        worldUpdate: worldState.lastEvolveResult,
        dialogue: buildDialogueText(chat, st.evolveReadRounds),
        replace
      });
    } catch (error) {
      console.error('[Công Cụ Nhân Vật] Chạy tự động thất bại', error);
    }
  }

  function onMessageReceived() {
    clearAutoTimer();
    autoRetries = 0;
    const ctx = window.SillyTavern?.getContext?.();
    const chat = ctx?.chat || [];
    const lastMsg = chat[chat.length - 1];
    if (!ctx || !lastMsg || lastMsg.is_user || !clean(lastMsg.mes)) return;
    const key = messageKeyOf(ctx, chat, lastMsg);
    if (lastProcessedKey === key) return;
    autoTimer = setTimeout(() => runAutoExtraction(key), AUTO_DELAY_MS);
  }

  // ================= Điền lại hàng loạt =================
  // Cài extension giữa chừng một cuộc trò chuyện dài thì toàn bộ quá khứ nằm ngoài tầm với:
  // engine chỉ đi tới từ lúc bật. Hàm này quét ngược từ tầng đầu, chia đợt gọi API để dựng hồ sơ.
  // Chỉ chạy pha trích xuất, không sinh hoạt động ngầm — quá khứ đã có chính văn rồi, bịa thêm
  // diễn biến nền vào đó chỉ tạo mâu thuẫn với những gì thật sự đã xảy ra.

  let backfillRunning = false;
  let backfillStatus = { running: false, current: 0, total: 0, message: '' };

  function setBackfillStatus(current, total, message) {
    backfillStatus = { running: backfillRunning, current, total, message };
    // Chuỗi "Đang điền lại i/M" là thứ quả cầu nổi nhận ra để vẽ vòng tiến độ.
    setStatus(total ? `Đang điền lại ${current}/${total} · ${message}` : message);
  }

  function formatRange(chat, from, to) {
    return asArray(chat).slice(from, to + 1)
      .map(message => `${message?.is_user ? 'Người chơi' : (clean(message?.name) || 'Nhân vật')}: ${clean(message?.mes)}`)
      .filter(line => line.split(': ').slice(1).join(': ').length > 0)
      .join('\n');
  }

  function stopBackfill() {
    if (!backfillRunning) return false;
    backfillRunning = false;
    setStatus('Đã yêu cầu dừng điền lại');
    return true;
  }

  async function backfill() {
    const st = settings(true);
    if (st.engineEnabled === false) throw new Error('Công Cụ Nhân Vật đang tắt');
    if (backfillRunning || running) return { skipped: true, reason: 'running' };

    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    const configuredEnd = Math.max(0, parseInt(st.backfillEndLayer) || 0);
    const end = Math.min(chat.length - 1, configuredEnd || chat.length - 1);
    const skipOpening = st.firstLayerIsAiOpening !== false;
    const aiLayers = chat
      .map((message, index) => (!message?.is_user && index <= end && !(skipOpening && index === 0) ? index : -1))
      .filter(index => index >= 0);

    const size = Math.max(1, parseInt(st.backfillBatchSize) || 5);
    const batches = [];
    for (let i = 0; i < aiLayers.length; i += size) batches.push(aiLayers.slice(i, i + size));
    if (!batches.length) { setBackfillStatus(0, 0, 'Không có tầng AI nào để điền lại'); return { skipped: true, reason: 'empty' }; }

    backfillRunning = true;
    notifyBusyChanged();
    abortController = new AbortController();

    // Sao lưu trước khi xoá: điền lại là thao tác ghi đè toàn bộ, không có đường lùi nào khác.
    try { window.WORLD_ENGINE_CHATCACHE?.forScope?.('npc')?.createSnapshot?.('Tự động trước khi điền lại'); }
    catch (error) { console.warn('[Công Cụ Nhân Vật] Không tạo được bản lưu trước khi điền lại', error); }

    const original = data().loadState();
    data().saveCheckpoint(original);
    // Giữ lại bộ nhớ đệm tuyến đường: đó là hiểu biết về địa lý thế giới, không phải trạng thái chat.
    data().saveState({
      ...data().defaultState(),
      travelCache: original.travelCache
    });

    try {
      const storyDay = core()?.getLastStoryDay?.();
      for (let i = 0; i < batches.length && backfillRunning; i++) {
        const layers = batches[i];
        const from = Math.max(0, layers[0] - 1);
        const to = layers[layers.length - 1];
        setBackfillStatus(i + 1, batches.length, `tầng ${from}-${to}`);

        const state = data().loadState();
        const dialogue = formatRange(chat, from, to);
        if (!dialogue) continue;

        const parsed = await callModel(window.NPC_ENGINE_PROMPT.buildPrompt({
          npcs: state.npcs,
          knownLimit: st.npcCoreLimit * 2,
          dialogue,
          worldbook: await buildWorldbookSection(dialogue, st),
          tonePrompt: st.tonePrompt,
          nameBlacklist: st.nameBlacklist,
          storyDay
        }), st);

        state.round += 1;
        state.chatLayer = to;
        mergeExtraction(state, parsed, to);
        data().saveState(state);
      }

      const finished = backfillRunning;
      setBackfillStatus(batches.length, batches.length, finished ? 'hoàn tất' : 'đã dừng');
      setStatus(finished ? 'Điền lại hoàn tất' : 'Điền lại đã dừng giữa chừng');
      return { skipped: false, batches: batches.length, finished };
    } catch (error) {
      setStatus('Điền lại thất bại: ' + (error?.message || error), true);
      throw error;
    } finally {
      backfillRunning = false;
      backfillStatus.running = false;
      abortController = null;
      applyInjection();
      notifyBusyChanged();
      try { window.WORLD_ENGINE_UI?.refresh?.(true); } catch (error) { /* không có UI thì thôi */ }
    }
  }

  // ================= Đọc thời gian truyện =================
  // Bắt người dùng cấu hình 6 ô regex mới đọc được thời gian là đòi hỏi vô lý, và phần lớn truyện
  // viết mốc thời gian bằng lời ("ba ngày sau", "sáng hôm sau") chứ không theo khuôn cố định.
  // Công Cụ Thế Giới giải quyết bằng cách bảo thẳng mô hình tự ước lượng từ chính văn; ở đây làm
  // giống vậy — engine đã gửi nguyên văn hội thoại đi rồi, hỏi luôn là xong.
  //
  // Thứ tự ưu tiên: bộ parse theo regex nếu người dùng có cấu hình (tất định), sau đó tới mô hình.
  function readStoryTime(state, extraction) {
    const parsedDay = core()?.getLastStoryDay?.();
    const reported = extraction?.time || {};
    const label = clean(reported.label);
    const modelElapsed = Number(reported.elapsedDays);
    const hasModelElapsed = Number.isFinite(modelElapsed) && modelElapsed >= 0;
    const previousDay = asLayer(state.lastStoryDay);

    let day = asLayer(parsedDay);
    let elapsed = null;
    let source = 'none';

    if (day !== null && previousDay !== null) {
      elapsed = Math.max(0, day - previousDay);
      source = 'regex';
    } else if (hasModelElapsed) {
      elapsed = Math.max(0, Math.round(modelElapsed));
      source = 'model';
      // Không cấu hình regex thì tự cộng dồn một bộ đếm ngày dựa trên báo cáo của mô hình.
      if (day === null) day = (previousDay ?? 0) + elapsed;
    } else if (day !== null) {
      source = 'regex';
    }

    if (day !== null) state.lastStoryDay = day;
    state.storyTime = { label, day, elapsedDays: elapsed, source };
    return { day, elapsed, label, source };
  }

  // ================= Chữa dữ liệu =================

  // Quét và sửa những chỗ không nhất quán tích tụ sau nhiều lượt: id trùng, tham chiếu tới nhân vật
  // không còn tồn tại, tri thức trỏ tới sự thật đã bị xoá, nhân vật trong kho còn nằm ở danh sách
  // hoạt động. Chỉ sửa, không xoá dữ liệu thật.
  function repairState(state) {
    const fixed = { duplicateIds: 0, danglingRelations: 0, danglingFacts: 0, misplacedArchive: 0, missingIds: 0 };
    const seen = new Set();

    for (const npc of [...state.npcs, ...state.archive]) {
      if (!clean(npc.id)) { npc.id = data().nextNpcId(state); fixed.missingIds += 1; }
      if (seen.has(npc.id)) { npc.id = data().nextNpcId(state); fixed.duplicateIds += 1; }
      seen.add(npc.id);
    }

    const names = new Set([...state.npcs, ...state.archive].map(npc => normalized(npc.name)));
    const factIds = new Set(asArray(state.publicFacts).map(fact => fact.id));

    for (const npc of [...state.npcs, ...state.archive]) {
      const relations = asArray(npc.relations?.npcs);
      const kept = relations.filter(link => !clean(link?.name) || names.has(normalized(link.name)));
      fixed.danglingRelations += relations.length - kept.length;
      npc.relations.npcs = kept;

      // factId trỏ tới sự thật đã biến mất thì gỡ liên kết, giữ lại nội dung tri thức.
      for (const item of asArray(npc.knowledge)) {
        if (item.factId && !factIds.has(item.factId)) { item.factId = null; fixed.danglingFacts += 1; }
      }
    }

    // Đánh dấu đã vào kho mà vẫn nằm ở danh sách hoạt động: chuyển về đúng chỗ.
    const misplaced = state.npcs.filter(npc => npc.status?.archived === true);
    for (const npc of misplaced) data().archiveNpc(state, npc.id, npc.status.condition);
    fixed.misplacedArchive = misplaced.length;

    state.scene.presentIds = asArray(state.scene?.presentIds).filter(id => seen.has(id));
    return fixed;
  }

  // Đối soát với lịch sử chat thật: tầng hiện tại ngắn hơn tầng đã ghi thì lùi về cho khớp.
  // Xoá lùi nhiều tầng một lúc thì điểm lưu một cấp không phủ hết, phải lọc theo dấu tầng.
  function reconcileHistory() {
    const layer = core()?.getChatLayer?.();
    if (!Number.isFinite(Number(layer))) return { changed: false, reason: 'no_layer' };
    const state = data().loadState();
    const stateLayer = asLayer(state.chatLayer);
    if (stateLayer === null || Number(layer) >= stateLayer) {
      const fixed = repairState(state);
      data().saveState(state);
      return { changed: false, repaired: fixed };
    }
    data().rollbackToLayer(state, Number(layer));
    const fixed = repairState(state);
    data().saveState(state);
    applyInjection(state);
    setStatus(`Đã đối soát về tầng ${layer}`);
    return { changed: true, layer: Number(layer), dropped: state.lastRollback?.dropped, repaired: fixed };
  }

  // ================= Sự kiện =================

  function onGenerationStarted(type, _opts, dryRun) {
    if (dryRun) return;
    // Nhận diện reroll bằng type gốc của Tavern. Tiêu chí thuần số (chatLayer === state.chatLayer) từng
    // gây hồi quy ở Công Cụ Thế Giới v2.3.18, vì GENERATION_STARTED phát ra trước khi tầng người dùng
    // được đẩy vào chat — lượt mới sẽ bị hiểu nhầm thành reroll.
    if (type === 'swipe' || type === 'regenerate') {
      const checkpoint = data().loadCheckpoint();
      if (checkpoint) applyInjection(checkpoint); else unregisterInjection();
      return;
    }
    applyInjection();
  }

  function onMessageSwiped() {
    const checkpoint = data().loadCheckpoint();
    if (checkpoint) applyInjection(checkpoint); else unregisterInjection();
  }

  function onMessageDeleted() {
    const layer = core()?.getChatLayer?.();
    if (!Number.isFinite(Number(layer))) return;
    const state = data().loadState();
    if (asLayer(state.chatLayer) === null || Number(layer) >= state.chatLayer) return;
    data().rollbackToLayer(state, Number(layer));
    data().saveState(state);
    applyInjection(state);
  }

  function init() {
    const ctx = window.SillyTavern?.getContext?.();
    if (!ctx?.eventSource) {
      console.warn('[Công Cụ Nhân Vật] Không gắn được sự kiện');
      return false;
    }
    const guard = window.WORLD_ENGINE_GUARD_EVENT || ((_label, _event, handler) => handler);
    const types = ctx.event_types || {};

    ctx.eventSource.on(types.GENERATION_STARTED || 'generation_started',
      guard('Công Cụ Nhân Vật', 'Bắt Đầu Sinh', onGenerationStarted));
    ctx.eventSource.on(types.MESSAGE_SWIPED || 'message_swiped',
      guard('Công Cụ Nhân Vật', 'Vuốt Tái Sinh', onMessageSwiped));
    ctx.eventSource.on(types.MESSAGE_DELETED || 'message_deleted',
      guard('Công Cụ Nhân Vật', 'Xóa Tin Nhắn', onMessageDeleted));
    ctx.eventSource.on(types.CHAT_LOADED || 'chat_loaded',
      guard('Công Cụ Nhân Vật', 'Tải Trò Chuyện', () => { reconcileHistory(); applyInjection(); }));
    // Lịch chạy riêng: không phụ thuộc việc Công Cụ Thế Giới có suy diễn lượt này hay không.
    ctx.eventSource.on(types.GENERATION_ENDED || types.MESSAGE_RECEIVED || 'message_received',
      guard('Công Cụ Nhân Vật', 'Sinh Xong', onMessageReceived));

    applyInjection();
    return true;
  }

  function abort() {
    if (abortController) abortController.abort();
    backfillRunning = false;
    running = false;
    runningLabel = '';
    setStatus('Đã gửi tín hiệu dừng');
    notifyBusyChanged();
  }

  return {
    init,
    applyInjection,
    abort,
    isRunning: () => running || backfillRunning,
    getRunningLabel: () => backfillRunning ? 'Điền lại hàng loạt' : runningLabel,
    getLastDebug: () => clone(lastDebug),
    getLastInjectionInfo: () => clone(lastInjectionInfo),
    ingestWorldEvolution,
    backfill,
    stopBackfill,
    getBackfillStatus: () => clone(backfillStatus),
    reconcileHistory,
    readStoryTime,
    repairState,
    buildWorldEngineContext,
    // Xuất ra để giao diện và kiểm thử dùng lại mà không phải gọi API.
    buildInjectionText,
    mergeExtraction,
    applyOffscreen,
    addPublicFact,
    acknowledgeFacts,
    INJECTION_NAME
  };
})();
