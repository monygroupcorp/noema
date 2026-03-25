/**
 * Info Manager - Handles basic informational commands like /start and /help,
 * and the delivery menu ℹ︎ button (view_gen_info:) for generation details.
 */

const { escapeMarkdownV2 } = require('../../../../utils/stringUtils');

// Keys that may contain LoRA syntax embedded in prompt text
const PROMPT_KEY_PATTERNS = ['prompt', 'user_prompt', 'input_prompt', 'positive_prompt', 'negative_prompt'];

function isPromptKey(key) {
  const lower = key.toLowerCase();
  return PROMPT_KEY_PATTERNS.some(p => lower === p || lower.includes('prompt'));
}

function stripLoraTags(str) {
  return String(str).replace(/<lora:[^>]+>/gi, '').replace(/\s{2,}/g, ' ').trim();
}

function shieldParamValue(key, val, generationRecord) {
  if (val === null || val === undefined) return 'null';

  const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);

  // Shield Telegram file links
  if (strVal.startsWith('https://api.telegram.org')) return '(telegram file)';

  // Shield image/media URLs
  if (/^https?:\/\/.+(\.png|\.jpg|\.jpeg|\.webp|\.gif|\.mp4|\.mov)/i.test(strVal)) return '(image)';
  if (/^https?:\/\/.*(imagedelivery|cdn-cgi|r2\.cloudflarestorage|s3\.amazonaws\.com|storage\.googleapis\.com)/i.test(strVal)) return '(image)';

  // For prompt-like keys: prefer clean metadata prompt, otherwise strip LoRA tags
  if (isPromptKey(key)) {
    const meta = generationRecord.metadata || {};
    const clean = meta.userInputPrompt || meta.originalPrompt || meta.userPrompt;
    if (clean) return clean;
    return stripLoraTags(strVal);
  }

  // Shield any remaining long URLs
  if (/^https?:\/\//.test(strVal) && strVal.length > 80) return '(url)';

  return strVal;
}

function formatKeyLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getPayloadEntries(generationRecord) {
  const payload = generationRecord.requestPayload;
  if (!payload || typeof payload !== 'object') return [];
  return Object.entries(payload).filter(([key]) => !key.startsWith('__'));
}

function buildParamListMenu(generationRecord, generationId) {
  const esc = escapeMarkdownV2;
  const emoji = generationRecord.status === 'completed' ? '✅' :
                generationRecord.status === 'failed' ? '❌' : '⏳';
  const parts = [];
  if (generationRecord.toolDisplayName) parts.push(esc(generationRecord.toolDisplayName));
  parts.push(`${emoji} ${esc(generationRecord.status || 'unknown')}`);
  if (generationRecord.cost !== undefined) parts.push(`${esc(String(generationRecord.cost))} pts`);
  const rerunCount = generationRecord.metadata?.rerunCount;
  if (rerunCount) parts.push(`↻${rerunCount}`);

  const text = `*${parts.join(' · ')}*\n${esc('Select a parameter:')}`;

  const entries = getPayloadEntries(generationRecord);
  const keyboard = [];
  for (let i = 0; i < entries.length; i += 2) {
    const row = [];
    row.push({ text: formatKeyLabel(entries[i][0]), callback_data: `view_gen_param:${generationId}:${entries[i][0]}` });
    if (i + 1 < entries.length) {
      row.push({ text: formatKeyLabel(entries[i + 1][0]), callback_data: `view_gen_param:${generationId}:${entries[i + 1][0]}` });
    }
    keyboard.push(row);
  }

  return { text, reply_markup: { inline_keyboard: keyboard } };
}

function buildParamDetailMenu(generationRecord, generationId, paramKey) {
  const esc = escapeMarkdownV2;
  const entries = getPayloadEntries(generationRecord);
  const entry = entries.find(([k]) => k === paramKey);
  const valueText = entry ? esc(shieldParamValue(paramKey, entry[1], generationRecord)) : esc('(not found)');
  const text = `*${esc(formatKeyLabel(paramKey))}*\n\n${valueText}`;
  const keyboard = [[{ text: '⇱ Back', callback_data: `view_gen_info_menu:${generationId}` }]];
  return { text, reply_markup: { inline_keyboard: keyboard } };
}

async function fetchGeneration(generationId, dependencies) {
  const apiClient = dependencies.internalApiClient || dependencies.internal?.client;
  if (!apiClient) throw new Error('internalApiClient missing');
  const res = await apiClient.get(`/internal/v1/data/generations/${generationId}`);
  if (!res.data) throw new Error('Generation not found');
  return res.data;
}

async function handleViewGenInfoCallback(bot, query, masterAccountId, dependencies) {
  const { logger } = dependencies;
  const generationId = query.data.substring('view_gen_info:'.length);
  logger.info(`[InfoManager/TG] view_gen_info for ${generationId}, MAID: ${masterAccountId}`);
  try {
    const generationRecord = await fetchGeneration(generationId, dependencies);
    const menu = buildParamListMenu(generationRecord, generationId);
    await bot.sendMessage(query.message.chat.id, menu.text, {
      parse_mode: 'MarkdownV2',
      reply_to_message_id: query.message.message_id,
      reply_markup: menu.reply_markup,
    });
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    logger.error(`[InfoManager/TG] Error for ${generationId}: ${err.message}`, err.stack);
    const userMsg = err.response?.status === 404 ? 'Generation not found.' : 'Could not load generation info.';
    await bot.answerCallbackQuery(query.id, { text: userMsg, show_alert: true });
  }
}

async function handleViewGenInfoMenuCallback(bot, query, masterAccountId, dependencies) {
  const { logger } = dependencies;
  const generationId = query.data.substring('view_gen_info_menu:'.length);
  try {
    const generationRecord = await fetchGeneration(generationId, dependencies);
    const menu = buildParamListMenu(generationRecord, generationId);
    await bot.editMessageText(menu.text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'MarkdownV2',
      reply_markup: menu.reply_markup,
    });
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    logger.error(`[InfoManager/TG] Error back-nav for ${generationId}: ${err.message}`);
    await bot.answerCallbackQuery(query.id, { text: 'Could not load.', show_alert: true });
  }
}

async function handleViewGenParamCallback(bot, query, masterAccountId, dependencies) {
  const { logger } = dependencies;
  const rest = query.data.substring('view_gen_param:'.length);
  const colonIdx = rest.indexOf(':');
  const generationId = rest.substring(0, colonIdx);
  const paramKey = rest.substring(colonIdx + 1);
  try {
    const generationRecord = await fetchGeneration(generationId, dependencies);
    const menu = buildParamDetailMenu(generationRecord, generationId, paramKey);
    await bot.editMessageText(menu.text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'MarkdownV2',
      reply_markup: menu.reply_markup,
    });
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    logger.error(`[InfoManager/TG] Error param view ${generationId}:${paramKey}: ${err.message}`);
    await bot.answerCallbackQuery(query.id, { text: 'Could not load parameter.', show_alert: true });
  }
}

async function handleStartCommand(bot, message, dependencies) {
  const welcomeMessage = `
Welcome to StationThis Deluxe Bot! 🎨

This bot helps you create amazing AI-generated art and manage your creative workflows. Here's how to get started:

1. Connect your wallet using /wallet or /account
2. Buy points using /buypoints to start creating
3. Access available tools with /tools

Once you're set up, you can start creating and exploring all our features!

Type /help to see a full list of available commands.
`;

  await bot.sendMessage(message.chat.id, welcomeMessage, {
    parse_mode: 'Markdown',
    reply_to_message_id: message.message_id
  });
}

async function handleContractAddressCommand(bot, message, dependencies) {
  const caMessage = "`0x98Ed411B8cf8536657c660Db8aA55D9D4bAAf820`\n";
  
  const keyboard = {
    inline_keyboard: [
      [
        { 
          text: 'Chart', 
          url: 'https://www.coingecko.com/en/coins/station-this'
        },
        {
          text: 'Buy',
          url: 'https://app.uniswap.org/swap?chain=mainnet&inputCurrency=0x0000000000c5dc95539589fbd24be07c6c14eca4&outputCurrency=0x98ed411b8cf8536657c660db8aa55d9d4baaf820'
        }
      ],
      [
        {
          text: 'Bridge MS2',
          url: 'https://portalbridge.com/'
        }
      ],
      [
        {
          text: 'Site',
          url: 'https://miladystation2.net'
        },
        {
          text: 'Web Platform',
          url: 'https://noema.art'
        }
      ]
    ]
  };

  await bot.sendMessage(message.chat.id, caMessage, {
    parse_mode: 'MarkdownV2',
    reply_markup: keyboard,
    reply_to_message_id: message.message_id
  });
}

async function handleHelpCommand(bot, message, dependencies) {
  const helpMessage = `
*Available Commands:*

Basic Commands:
• /start - Show welcome message and getting started guide
• /help - Display this help message
• /status - Check bot and service status
• /ca - View contract address and trading info
• /feedback - Provide feedback to the bot

Account & Points:
• /wallet - Connect or manage your wallet
• /account - View your account details
• /buypoints - Purchase points for generations

Creation Tools:
• /tools - Access available creation tools and workflows
• /settings - Configure your preferences

Need more help? Feel free to check our documentation or join our community!
`;

  await bot.sendMessage(message.chat.id, helpMessage, {
    parse_mode: 'Markdown',
    reply_to_message_id: message.message_id
  });
}

function registerHandlers(dispatcherInstances, dependencies) {
  const { commandDispatcher, callbackQueryDispatcher } = dispatcherInstances;

  // Register /start command
  commandDispatcher.register(/^\/start(?:@\w+)?$/i, (bot, message, deps) => 
    handleStartCommand(bot, message, deps)
  );

  // Register /help command
  commandDispatcher.register(/^\/help(?:@\w+)?$/i, (bot, message, deps) => 
    handleHelpCommand(bot, message, deps)
  );

  // Register /ca command
  commandDispatcher.register(/^\/ca(?:@\w+)?$/i, (bot, message, deps) =>
    handleContractAddressCommand(bot, message, deps)
  );

  // Register delivery menu ℹ︎ info button and its sub-navigation
  callbackQueryDispatcher.register('view_gen_info:', (bot, query, maid) =>
    handleViewGenInfoCallback(bot, query, maid, dependencies)
  );
  callbackQueryDispatcher.register('view_gen_info_menu:', (bot, query, maid) =>
    handleViewGenInfoMenuCallback(bot, query, maid, dependencies)
  );
  callbackQueryDispatcher.register('view_gen_param:', (bot, query, maid) =>
    handleViewGenParamCallback(bot, query, maid, dependencies)
  );
}

module.exports = {
  registerHandlers
}; 