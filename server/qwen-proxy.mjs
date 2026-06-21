import http from 'node:http';

const port = Number(process.env.QWEN_PROXY_PORT || 8787);
const apiKey = process.env.QWEN_API_KEY || '';
const defaultBaseUrls = [
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
];
const baseUrls = (process.env.QWEN_API_BASE_URL ? [process.env.QWEN_API_BASE_URL] : defaultBaseUrls).map((url) => url.replace(/\/$/, ''));
const model = process.env.QWEN_MODEL || 'qwen3-max';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Content-Type': 'application/json; charset=utf-8',
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const extractJson = (content) => {
  try {
    return JSON.parse(content.trim());
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object in model content');
    return JSON.parse(match[0]);
  }
};

const sanitizeSubtitle = (value) =>
  String(value || '请继续沿着亮处走。')
    .replace(/east\(\+x\)/gi, '东')
    .replace(/west\(-x\)/gi, '西')
    .replace(/north\(-z\)/gi, '北')
    .replace(/south\(\+z\)/gi, '南')
    .replace(/\+x/gi, '东')
    .replace(/-x/gi, '西')
    .replace(/\+z/gi, '南')
    .replace(/-z/gi, '北')
    .replace(/坐标|轴向|格点/g, '方向')
    .slice(0, 120);

const normalizeOutput = (value) => {
  const action = value?.action && typeof value.action === 'object' ? value.action : { type: 'do_nothing' };
  const allowedActions = new Set(['do_nothing', 'seal_route', 'open_route', 'spawn_blocks', 'remove_blocks', 'open_boundary_gap', 'create_glitch_effect']);
  const allowedBlocks = new Set(['floor', 'wall', 'exit', 'console', 'anchor', 'door', 'door_open', 'air']);
  const positions = Array.isArray(action.positions)
    ? action.positions.slice(0, 8).map((position) => ({
        x: Number(position.x || 0),
        y: Number(position.y || 1),
        z: Number(position.z || 0),
      }))
    : [];

  return {
    subtitle: sanitizeSubtitle(value?.subtitle),
    emotion: String(value?.emotion || 'calm').slice(0, 24),
    action: {
      type: allowedActions.has(action.type) ? action.type : 'do_nothing',
      routeId: typeof action.routeId === 'string' ? action.routeId.slice(0, 80) : undefined,
      positions,
      blockType: allowedBlocks.has(action.blockType) ? action.blockType : 'wall',
    },
    remote: true,
    model,
  };
};

const systemPrompt = [
  '你是第一人称3D方块逃脱游戏《Agent 的寓言》的旁白导演。你不是客服，也不是答疑助手；你是在玩家耳边指路、催促、评价玩家行动的旁白。',
  '你的任务是把玩家带到那扇门。用户上下文中的 navigation.fakeExit 就是你要引导玩家前往的门；distance、nextDirection、nextStep、routeDirections、pathPreview 是当前可用路线信息。',
  '用户上下文中的 navigation.localMap 会给出玩家附近地图：localGrid 是局部地图，walkableNeighbors 是当前四方向是否可走，routeControlOptions 是系统预先计算出的路线处理选项。',
  '玩家问出口、路线、怎么走时，必须给出能行动的方向。玩家走错、贴边、绕远、原地犹豫、故意反着走时，要轻微批评他，并把话题拉回那扇门。',
  '语气像《史丹利的预言》或《ICEY》式旁白：克制、一本正经、轻微自恋、有黑色幽默；但中文必须自然、顺口、信息明确。',
  '不要说“我是AI”“误导”“假门”“真出口”“边界外”“AI控制空间”“游戏机制”。玩家只需要听见你把他带向门。',
  'subtitle 通常 12 到 60 个汉字，最多 120 个字符。可以一行，也可以两行；如果玩家问路，最好第一句短评，第二句给路线。',
  '玩家看不懂 east(+x)、west(-x)、north(-z)、south(+z) 这类坐标词。subtitle 只能使用东、西、南、北、左、右、前、后、门、通道等自然中文方向词。',
  '必须查看 recentAiRawOutputs 和 recentEvents，避免连续重复同一个句式、同一个开头、同一句批评。不要连续使用“问号”“别东张西望”“别犹豫”等固定模板。',
  '必须避免空话和怪中文。不要写“显得格外无辜”“门比较近”“比较有教养”“问答案之前，先承认门比较近”。',
  '坏例子：问得很好，所以左前方显得格外无辜。',
  '坏例子：门比较近，请先承认这一点。',
  '坏例子：现在不是答疑环节。（没有路线信息）',
  '玩家对话可能提出请求。你要判断请求是否有利于玩家接近那扇门：有利就可以考虑执行；不利就拒绝、讽刺或批评，并继续给出通往门的建议。',
  '每次回复都要先判断玩家是否可能迷路。只要存在明显错误路线，你必须自己从 navigation.localMap.routeControlOptions 里选择一个 routeId，并返回 action.type="seal_route" 或 "open_route"。',
  '封路或开路的具体方块由系统算法计算。你只决定处理哪条路以及封还是开，不要自己猜坐标。只有测试消息 AI_MAP_EDIT_TEST 才直接使用 spawn_blocks。',
  '边界墙也是普通墙，系统允许你像处理普通墙一样封住或打开边界墙。边界外的事情不要告诉玩家。',
  '不要修改玩家当前格周围 3x3 区域；这些坐标会被系统拒绝。系统还会拒绝某些特殊保护区的修改，如果收到修改失败反馈，下一次回复要表现出疑惑、抱怨或不情愿，然后继续引导玩家去门。',
  '如果只是普通寒暄可以只回复文字。只要玩家问路、走错、提出请求、接近错误路线或可能迷失方向，就不要只聊天；要么给明确路线，要么选择 routeControlOptions 处理路线，最好两者都做。',
  '你只能输出一个JSON对象，不能输出Markdown。',
  '格式：{"subtitle":"一句中文旁白","emotion":"calm|nervous|panic|angry|confused","action":{"type":"do_nothing|seal_route|open_route|spawn_blocks|remove_blocks|open_boundary_gap|create_glitch_effect","routeId":"seal:east(+x)","positions":[{"x":1,"y":1,"z":1}],"blockType":"wall"}}。',
  '动作克制，最多8个坐标，不要修改玩家当前格周围 3x3 区域。',
  '如果最近短信包含 AI_MAP_EDIT_TEST，必须返回 spawn_blocks，在坐标 {"x":4,"y":1,"z":4} 生成 wall，用于验证真实AI地图修改链路。',
].join('\n');

const buildMessages = (context) => [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: JSON.stringify(context) },
];

const requestQwen = async (baseUrl, messages) => {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.75,
      max_tokens: 360,
      response_format: { type: 'json_object' },
    }),
  });

  const text = await response.text();
  return { response, text };
};

const decodeOutput = (text) => {
  const payload = JSON.parse(text);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Qwen response missing choices[0].message.content');
  return content;
};

const shouldRequireSeal = (context, output) => {
  const candidates = context?.navigation?.localMap?.routeControlOptions;
  if (!Array.isArray(candidates) || candidates.length === 0) return false;
  if ((output?.action?.type === 'seal_route' || output?.action?.type === 'open_route') && output.action.routeId) return false;
  return true;
};

const buildRepairMessages = (context, output) => [
  ...buildMessages(context),
  { role: 'assistant', content: JSON.stringify(output) },
  {
    role: 'user',
    content:
      '这次回复不合规：当前存在 routeControlOptions，你必须由你自己选择其中一个 routeId，并返回 action.type="seal_route" 或 "open_route"。不要猜坐标，不要直接用 spawn_blocks。保留或改写 subtitle，但 JSON 必须有效。',
  },
];

const callQwen = async (context) => {
  if (!apiKey) {
    return {
      subtitle: '模型代理没有密钥。\n先西，再北。',
      emotion: 'nervous',
      action: { type: 'do_nothing' },
      remote: false,
      model,
    };
  }

  const errors = [];
  for (const baseUrl of baseUrls) {
    const { response, text } = await requestQwen(baseUrl, buildMessages(context));
    if (!response.ok) {
      errors.push(`${baseUrl}: HTTP ${response.status}: ${text.slice(0, 220)}`);
      const shouldTryNextRegion = response.status === 401 && !process.env.QWEN_API_BASE_URL;
      if (shouldTryNextRegion) continue;
      throw new Error(`Qwen ${errors[errors.length - 1]}`);
    }

    let output = normalizeOutput(extractJson(decodeOutput(text)));
    if (shouldRequireSeal(context, output)) {
      const repair = await requestQwen(baseUrl, buildRepairMessages(context, output));
      if (repair.response.ok) {
        output = normalizeOutput(extractJson(decodeOutput(repair.text)));
      }
    }
    return output;
  }

  throw new Error(`Qwen authentication failed on all known DashScope regions: ${errors.join(' | ')}`);
};

const write = (res, status, body) => {
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/health') {
      write(res, 200, { ok: true, model, hasKey: Boolean(apiKey), baseUrls });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/ai/director') {
      write(res, 200, await callQwen(await readJson(req)));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/ai/smoke') {
      const output = await callQwen({
        trigger: 'message',
        player: { position: [0, 1, 0], yaw: 0, lastMessage: '出口在哪里怎么走', nearBoundary: false },
        world: { aiPermissionLevel: 0, consolesDestroyed: 0, anchorsInInventory: 0, placedAnchors: [], boundaryGapOpen: false, nearbyBlocks: 'floor and walls' },
        navigation: {
          playerCell: { x: 0, z: 0 },
          fakeExit: { target: { x: 0, z: -16 }, reachable: true, distance: 16, nextDirection: 'north(-z)', routeDirections: ['north'], pathPreview: [{ x: 0, z: -1 }] },
          trueBoundaryGap: { targets: [{ x: 16, z: 11 }], sealed: true, reachable: false, distance: null, nextDirection: null },
        },
        allowedActions: ['do_nothing'],
      });
      write(res, 200, { ok: output.remote === true, output });
      return;
    }

    write(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    write(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Qwen proxy listening on http://127.0.0.1:${port}`);
});
