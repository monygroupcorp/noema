# Changelog

## [4.11.0](https://github.com/monygroupcorp/noema/compare/v4.10.8...v4.11.0) (2026-06-11)


### Features

* **tools:** add gpt-image-edit (/imgedit) — OpenAI image editing with multi-image reference ([ca5162c](https://github.com/monygroupcorp/noema/commit/ca5162c1c59d25b59a47a24328e10ce924d129af))


### Bug Fixes

* **agents:** bake factory NFT binding into step-level parameterMappings ([883e4da](https://github.com/monygroupcorp/noema/commit/883e4da26ea4bc9f7e0ae9745638d3c942d63f3c))
* **sandbox:** agent-context validator, auto-connect type guard, seeking badge ([2efb868](https://github.com/monygroupcorp/noema/commit/2efb868af21900fd896d87dd9b05450f7500bd67))
* **telegram:** /cast sources image from attached photo, not only reply ([b81afed](https://github.com/monygroupcorp/noema/commit/b81afed049bd98de40e22a046dc0c66c5530a064))

## [4.10.8](https://github.com/monygroupcorp/noema/compare/v4.10.7...v4.10.8) (2026-06-04)


### Bug Fixes

* **agents:** de-shadow public CAMEL routes from cook/batch auth catch-all ([b89faa1](https://github.com/monygroupcorp/noema/commit/b89faa143eb1e6c52ec52a43a8ca9ba82005cb42))

## [4.10.7](https://github.com/monygroupcorp/noema/compare/v4.10.6...v4.10.7) (2026-06-04)


### Bug Fixes

* **agents:** complete CAMEL go-live surface — JWKS override, provisioned-agent resolution, cast tagging ([d4d9c8b](https://github.com/monygroupcorp/noema/commit/d4d9c8b5951c6d464fd9adbc97037a5905646fe3))
* **agents:** route CAMEL onboarding through WorkspaceFactory ([aca6ab6](https://github.com/monygroupcorp/noema/commit/aca6ab66491290dd7f0868b1016cdde801c5fa62))
* **sandbox:** render typed input anchors on spell windows ([8b23bbc](https://github.com/monygroupcorp/noema/commit/8b23bbcf02eed28386eb64e909d0b82e4df418c4))

## [4.10.6](https://github.com/monygroupcorp/noema/compare/v4.10.5...v4.10.6) (2026-05-22)


### Bug Fixes

* **training:** use hf CLI for uploads + never terminate unpersisted model ([06430f5](https://github.com/monygroupcorp/noema/commit/06430f57f4a3d2b42710810ff8c8a86dbdfec8d9))

## [4.10.5](https://github.com/monygroupcorp/noema/compare/v4.10.4...v4.10.5) (2026-05-22)


### Bug Fixes

* **agents:** add agent card federation endpoints ([0c7eaf5](https://github.com/monygroupcorp/noema/commit/0c7eaf510d576b4bc1569b6365363506f9e1c62a))
* **agents:** add agent session manifest and revoke endpoints ([accb2e1](https://github.com/monygroupcorp/noema/commit/accb2e16a96d72a4a342333293cb0aa287a661b2))
* **agents:** add agentCardFetcher with 5-min cache ([0fa905b](https://github.com/monygroupcorp/noema/commit/0fa905bf5a531320141e5be0910faf59bda51fb8))
* **agents:** add CAMEL agent provisioning endpoint ([82d7f1c](https://github.com/monygroupcorp/noema/commit/82d7f1cbb0468cd3b49982e34b0d5caf74a4c21b))
* **agents:** add CamelJwtVerifier ES256 JWT verification utility ([2651932](https://github.com/monygroupcorp/noema/commit/2651932ce186dc546404b79cf57d33a286c945c0))
* **agents:** add Step 10 management endpoints (topup, payout-policy, earnings, donate) ([2ecc8f1](https://github.com/monygroupcorp/noema/commit/2ecc8f1b2e156e4322866a20132faa7e713d30d8))
* **agents:** add Step 11 faucet cron — agentFaucetWorker + FaucetDripsDB ([5c19d7e](https://github.com/monygroupcorp/noema/commit/5c19d7e3cf688ecd7bca5c106a67c969cf215802))
* **agents:** add treasury admin API endpoints ([38150b5](https://github.com/monygroupcorp/noema/commit/38150b5404b82dbf74f5f6531caa8517586798cd))
* **agents:** add TreasuryDB and AgentAccountDB data models ([d33007a](https://github.com/monygroupcorp/noema/commit/d33007a87a8d7ba0eb82e3f7db811284f46c7b4c))
* **agents:** address final review — CamelJwtVerifier bootstrap, donate economy credit, env slug ([0a1cbf4](https://github.com/monygroupcorp/noema/commit/0a1cbf436be740d12b3334f6ff1bf5503a108559))
* **agents:** address Step 1 review: ensureIndexes wiring, ownerAddress normalization, setStatus method ([fc01e57](https://github.com/monygroupcorp/noema/commit/fc01e57ffac8dbe584adca01c8a7bb753187645d))
* **agents:** address Step 10 review — donate partial-failure, payout-policy auth note, earnings query ([b180802](https://github.com/monygroupcorp/noema/commit/b180802df546f150de038ccbe57fa81e1ebb9876))
* **agents:** address Step 11 review — monthlyMax guard, score clamping, error stage separation ([7babbd0](https://github.com/monygroupcorp/noema/commit/7babbd0a32f06e2150f48f9f376ed32394c30ff0))
* **agents:** address Step 2 review: iss enforcement, concurrent JWKS fetch, TTL default ([2c8a14a](https://github.com/monygroupcorp/noema/commit/2c8a14a9538820495ef78c3b9fa45fe7b5b69c09))
* **agents:** address Step 4 review: cache entry consistency, concurrent failure test ([07b02be](https://github.com/monygroupcorp/noema/commit/07b02be1b3282cd94cc48e7479d7c432047c6262))
* **agents:** address Step 5 review: atomic debit, optional treasuryId, agent count, policy validation ([1ad4ce9](https://github.com/monygroupcorp/noema/commit/1ad4ce92d42ee5e45ccb6668792fd4d9647e44a2))
* **agents:** address Step 6 review: setStatus safety, session callback client, injectable card fetcher ([307c647](https://github.com/monygroupcorp/noema/commit/307c647751fd13d9f00c87e15e80cf1fe7c6186f))
* **agents:** address Steps 7+9 review: manifest status, partnerId schema, atomicUsdcToUsd ([4083006](https://github.com/monygroupcorp/noema/commit/40830067e122c1ef4888a077115008a9e0ee8acd))
* **agents:** extract agentSessionCallback and agentUtils from provisioning endpoint ([406a3c1](https://github.com/monygroupcorp/noema/commit/406a3c1861bc119ebff976d7fde2b4d7d71a0007))
* **agents:** Fix 12 — align faucet cap window with cadence, not calendar month ([412b6fd](https://github.com/monygroupcorp/noema/commit/412b6fd83b371fb48d075505f6b207772c3929b5))
* **agents:** Fix 4-11 — perCycleBudget, skipped drips, JWKS rotation, 501 earnings, topup creditPoints ([6a3010c](https://github.com/monygroupcorp/noema/commit/6a3010ce3e59b182862f150acba590d2a4f38581))
* **agents:** implement earnings + recentUsage via splitLedger.findByAgentId ([632848b](https://github.com/monygroupcorp/noema/commit/632848b691b267df4bad1793cc7601f67bdffde2))
* **agents:** Round 2 hardening — donate, delegation tests, spendingCap removal, 19 audit fixes ([f8c5eda](https://github.com/monygroupcorp/noema/commit/f8c5eda13f30188e6856e712dcbc9795ea11dc7e))
* **agents:** store agentChainId+agentAdapter from JWT sub for adapter-owned NFT ownership ([b0ae3b0](https://github.com/monygroupcorp/noema/commit/b0ae3b0dc2b4546d69973ac854b0a946bcba1f1d))
* **agents:** wire agentJwtVerifier+economyService; per-treasury workspace; suspended retry ([bb3a736](https://github.com/monygroupcorp/noema/commit/bb3a7369f00280ec6b31dcf8feaa618a0f39bfb6))
* **camel:** perCycleBudget backward-compat + hardening test coverage ([d33fae5](https://github.com/monygroupcorp/noema/commit/d33fae5931bd6ef4a8a1bac776952a52f0e7b6f0))
* external generations /execute uses getToolById (getTool was undefined) ([40ac602](https://github.com/monygroupcorp/noema/commit/40ac602e53317f44377de2667d3d7792bb1f8d26))
* **partner:** add run status polling endpoint and castId tracking ([91c096b](https://github.com/monygroupcorp/noema/commit/91c096b7df7196ec414af08dff045378ee62849e))
* **partner:** factor ComfyUI Deploy webhook progress into run status ([9969502](https://github.com/monygroupcorp/noema/commit/996950264bc0d8fcfbf955ae26155517c98fe5b4))
* **partner:** weight run progress by historical step duration ([d8ddadd](https://github.com/monygroupcorp/noema/commit/d8ddaddd79dcf28696fe739fc259adaa60343ebe))

## [4.10.4](https://github.com/monygroupcorp/noema/compare/v4.10.3...v4.10.4) (2026-05-18)


### Bug Fixes

* **partner:** wire spell execution dispatch and drop deprecated published check ([b66cbc7](https://github.com/monygroupcorp/noema/commit/b66cbc7a3b15fed08f687ec85f0f3907c7043b5b))

## [4.10.3](https://github.com/monygroupcorp/noema/compare/v4.10.2...v4.10.3) (2026-05-18)


### Bug Fixes

* **pricing:** reduce comfyui markup to 1.5x and quote x402 price from historical data ([dc2eb61](https://github.com/monygroupcorp/noema/commit/dc2eb617c02b58934ebda612010c660c25b0aa15))
* **quotes:** improve quoteSpell accuracy and robustness ([bef2e08](https://github.com/monygroupcorp/noema/commit/bef2e087d004195ecd0eddae5a8bdb001e91826e))

## [4.10.2](https://github.com/monygroupcorp/noema/compare/v4.10.1...v4.10.2) (2026-05-16)


### Bug Fixes

* **webhook:** use req.rawBody for HMAC and req.body as parsed payload ([afebbd8](https://github.com/monygroupcorp/noema/commit/afebbd8eb233683b61277909441cd3efef80e772))

## [4.10.1](https://github.com/monygroupcorp/noema/compare/v4.10.0...v4.10.1) (2026-05-16)


### Bug Fixes

* **db:** remove sparse+partialFilter conflict and drop unsupported $ne:null in partial index ([9fa6ffb](https://github.com/monygroupcorp/noema/commit/9fa6ffb4958bc31735f18561cbe77fe810e82f54))

## [4.10.0](https://github.com/monygroupcorp/noema/compare/v4.9.7...v4.10.0) (2026-05-15)


### Features

* **camel:** agent dashboard — spell composition, owner auth, delegation, widget ([10bbd1e](https://github.com/monygroupcorp/noema/commit/10bbd1e1607b457ddd38c79dada7995209c6dc4e))
* **partner:** /widget/partner iframe route ([988f8c7](https://github.com/monygroupcorp/noema/commit/988f8c72b903cce108683ad0c613f8538694cc22))
* **partner:** add StationThis.initWidget() to SDK ([f407e73](https://github.com/monygroupcorp/noema/commit/f407e73d91b8792c1743366f17a93dd835d0139b))
* **partner:** admin CRUD for partner management ([9961e7f](https://github.com/monygroupcorp/noema/commit/9961e7f8c9c602367e83529f271f77c51c68240e))
* **partner:** mount presign and partner run routes in external API ([bdbd749](https://github.com/monygroupcorp/noema/commit/bdbd749a2ffdab9a8de5df8988fb6b2e67ee0261))
* **partner:** partner spell run endpoint ([5517b23](https://github.com/monygroupcorp/noema/commit/5517b23ddabde846b1b2932f3a8cfeab01304a09))
* **partner:** presign endpoint ([d8b46ed](https://github.com/monygroupcorp/noema/commit/d8b46edd2354b529ea9a643fcbeb1e9930fdf34b))
* **partner:** register partner, uploadRecords, splitLedger DB services ([9c0590f](https://github.com/monygroupcorp/noema/commit/9c0590f0c5f408f763fe5b84eb519c8fb15c9361))
* **partner:** UploadRecordDB model ([a9c8e67](https://github.com/monygroupcorp/noema/commit/a9c8e678fa81dce99e2bbdea2ddc608d986bcd88))
* **runpod:** GenerationRunner orchestrator (wave 2) ([4b06476](https://github.com/monygroupcorp/noema/commit/4b0647663f949555bedeeea77ae337dcc360ab16))
* **runpod:** GPUScheduler, StallDetector, OutputUploader (wave 1) ([6c073c9](https://github.com/monygroupcorp/noema/commit/6c073c974e63a6c65adfc788ce1ef102705ccb73))
* **runpod:** RunPodAdapter wires runmake to GenerationRunner ([7e4f9a2](https://github.com/monygroupcorp/noema/commit/7e4f9a2010aa751331efab3ee67b60c1b9400699))
* **widget:** collection gallery, IpfsService/Pinata, x402 spell route, WorkspaceFactory hardening ([76d13f6](https://github.com/monygroupcorp/noema/commit/76d13f6e96fb021f702e38b5dea3469cde6cd0e3))


### Bug Fixes

* add agent_owner_unclaimed support to SplitLedgerDB ([aa20a87](https://github.com/monygroupcorp/noema/commit/aa20a8781abb04fffa7f256b19d04b67615ad01d))
* add AgentOwnerUnclaimedEntry typedef and clarify BaseDB null contract ([b0a3b6a](https://github.com/monygroupcorp/noema/commit/b0a3b6a78adf2119d74f903fbdd18b0c3083a1e8))
* add distributeAgentOwnerReward with fallback chain for x402 runs ([e05b63e](https://github.com/monygroupcorp/noema/commit/e05b63e6a63ca1896764184e11c969b050b4d748))
* add generationExecutionService coverage to economy constants test ([4f47132](https://github.com/monygroupcorp/noema/commit/4f471322c6efb41031884e009788a431520b0296))
* add incrementContributorRewards and fix error return in agentOwnerReward ([5ec1654](https://github.com/monygroupcorp/noema/commit/5ec16541ac2560661230d386c6064b5387ca4e3b))
* add revShareBps admin endpoint for collection rev-share configuration ([719d57f](https://github.com/monygroupcorp/noema/commit/719d57fd4a0e5ca3abd18208b02b3c7b86bed460))
* **admin:** setRevShareBps returns 404 on unknown collection ([455d69d](https://github.com/monygroupcorp/noema/commit/455d69d17e4ac60581e5d77c18bfb14801e205d2))
* **auth:** fall back to JWT_SECRET when AGENT_SESSION_SECRET not set ([35a87c9](https://github.com/monygroupcorp/noema/commit/35a87c9d3e4bf7bf3b51ecb51d2bf8cdb8895a33))
* **billing:** correct GPU rate lookup and spell quote pricing ([66437cc](https://github.com/monygroupcorp/noema/commit/66437ccad8be7b12ac6adf3fc6d456d5a377319e))
* centralize USD_PER_POINT to src/core/constants/economy.js ([6e69dfd](https://github.com/monygroupcorp/noema/commit/6e69dfdd6f95ef020c25f26518a642ea70ad07e8))
* **charging:** daily dragnet credits unclaimed agent owner rewards ([3ddedd3](https://github.com/monygroupcorp/noema/commit/3ddedd325f2e1711591f77749b5f4d637592cee5))
* **ci:** disable GHA docker cache for staging — was serving stale manifest ([f419131](https://github.com/monygroupcorp/noema/commit/f41913127c7f27a1f95a999581e7dc817847fac6))
* **ci:** scope staging docker cache to git SHA — fast retries, never stale ([3ebddaa](https://github.com/monygroupcorp/noema/commit/3ebddaa5f950037e5864c3d95f77fc8b7c42a4a9))
* **db:** partial filter on agent-id index to skip null agentId accounts ([daa1938](https://github.com/monygroupcorp/noema/commit/daa1938c7aab9228d22d0e7b39044509b2d4425a))
* **docker:** copy microact + micro-web3 ESM builds into image for widget iframe ([67caf7d](https://github.com/monygroupcorp/noema/commit/67caf7db78d88b29220bd22436856cafc638931f))
* **dragnet:** document partial-write risk and add batch-full warning ([1b2b297](https://github.com/monygroupcorp/noema/commit/1b2b297a6896ec69e55dad9e2a3ad1b82fe250f9))
* **gallery:** skeleton shimmer shows minimum 600ms regardless of cache ([c745184](https://github.com/monygroupcorp/noema/commit/c7451846ebf7ee99a504f543ff5586997d702cbb))
* **gallery:** skeletons, lightbox, hide, CSS overrides, incremental render ([074de60](https://github.com/monygroupcorp/noema/commit/074de60fdb528e8e3e7dd04ca0ef57427137dac6))
* include loraResolutionData in immediate path generationParams metadata ([ec2b025](https://github.com/monygroupcorp/noema/commit/ec2b025e2069321c20da87e6ae40fa1d4cd6d293))
* **issuers:** DB-backed trusted issuers replaces per-partner env vars ([20843ca](https://github.com/monygroupcorp/noema/commit/20843ca4a034a50010302e2df0c9a29a0b8a4e89))
* **lora:** spell author private models pass through to all spell executors ([719d7a7](https://github.com/monygroupcorp/noema/commit/719d7a7749ad5a9f315a4cea44377dfe9ab6f446))
* **partner:** add indexes and test cleanup to PartnerDB ([0207c67](https://github.com/monygroupcorp/noema/commit/0207c678262e823ed292c2255efc8a04d0220d7c))
* **partner:** admin findPartnerByIdAny, empty-patch guard, listByPartner ([fb943f0](https://github.com/monygroupcorp/noema/commit/fb943f0034be20423ecda0fd45e046f94eed1a1c))
* **partner:** db.data path, ensureIndexes startup, markUsed race check ([a16f8d2](https://github.com/monygroupcorp/noema/commit/a16f8d24b26c26c7a2331cf799efab27a74fc321))
* **partner:** guard presign mount and x402Enabled check in external API ([d712686](https://github.com/monygroupcorp/noema/commit/d71268609c76a887643c200502dceaa4c67ebd99))
* **partner:** initWidget source check, pinned postMessage origin, partnerId guard ([8603cd0](https://github.com/monygroupcorp/noema/commit/8603cd05c954e100a14b222ed9adc093ec252447))
* **partner:** PartnerDB model ([bbb74de](https://github.com/monygroupcorp/noema/commit/bbb74deedb8b4445512b17de19030598ac4b6624))
* **partner:** presign error handling, filename sanitization, domain port stripping ([07565ab](https://github.com/monygroupcorp/noema/commit/07565abdd4fccd0398a1e6525e82703b9f8a6b90))
* **partner:** SplitLedgerDB model ([eee4b07](https://github.com/monygroupcorp/noema/commit/eee4b07fa0e6016356eb9e3151e27af79f28fd23))
* **partner:** uploadRecord status gate + queue bypass ([adc403d](https://github.com/monygroupcorp/noema/commit/adc403d8e4df1ec4980c5d33f5923926de66af84))
* **partner:** wrap SplitLedgerDB ensureIndexes in dbQueue ([29e26f4](https://github.com/monygroupcorp/noema/commit/29e26f419032840d7ab5c0ceb87dab4baadc76e1))
* **partner:** x402 payment flow — USD conversion, recordPaymentVerified, settle check ([e3f165c](https://github.com/monygroupcorp/noema/commit/e3f165ce21117d867279588d06d7ac3fb7a0d98f))
* propagate isX402/payerAddress/x402BasePoints through ImmediateStrategy ([a9380ef](https://github.com/monygroupcorp/noema/commit/a9380ef815cf44cc0ea9c0dc6c245892bac83a93))
* **runpod:** lock in SECURE direct-IP as the ComfyUI Deploy replacement ([e4b9161](https://github.com/monygroupcorp/noema/commit/e4b9161ed701b7eb8ec734b3196e3e8b5cf3a39f))
* **runpod:** Tier A hardening + runmake tool definition ([78811be](https://github.com/monygroupcorp/noema/commit/78811becb9313bef46744b9b13e71cc9dd4f35dd))
* **sdk:** relay wallet on WIDGET_READY without owner challenge, remove double sign-in ([7e25cc7](https://github.com/monygroupcorp/noema/commit/7e25cc7523cc8d6d307cd5eb8ef5d971e6f81ee4))
* **sdk:** trigger auto-auth on WIDGET_READY and relay wallet address immediately ([db9592b](https://github.com/monygroupcorp/noema/commit/db9592b8964d477ab6e4dddeec60f06d12af3656))
* use grossAmount basis for agent owner points in partnerRunApi ([38bfaef](https://github.com/monygroupcorp/noema/commit/38bfaeffb09c072eda6be9b95de38fdbf6e32c22))
* **widget:** default to list mode, canvas falls through to spell list ([76549a5](https://github.com/monygroupcorp/noema/commit/76549a52f8e4d638aa68eb82a13728e62f1e800a))
* **widget:** lightbox for in-widget gallery + cast result images ([29792b3](https://github.com/monygroupcorp/noema/commit/29792b33a9651c64112277e029dd608b72ef05f4))
* **widget:** owner lands on spells, noema link, gallery lightbox via postMessage ([26074dd](https://github.com/monygroupcorp/noema/commit/26074dd038cc3e19c95372c7269709b614980596))
* **widget:** show step progress and elapsed time during spell cast polling ([bc3ad68](https://github.com/monygroupcorp/noema/commit/bc3ad68769c6bfee8e111496d56eddc0e02d3a10))
* wire agent owner rev-share and x402 context into widget spell endpoint ([fb99ab3](https://github.com/monygroupcorp/noema/commit/fb99ab3b22328d1c86254204ba8b690c57f5d115))
* wire agent owner rev-share into partner proxy run endpoint ([94b0566](https://github.com/monygroupcorp/noema/commit/94b05665e4275458b905f7b888da67e633d5a4ba))
* wire distributeContributorRewards into x402 path in generationExecutionService ([8561963](https://github.com/monygroupcorp/noema/commit/856196328ec90dc75a9c7b4b7db0fc4e2e946122))
* **x402-royalty:** address final code review issues ([8406656](https://github.com/monygroupcorp/noema/commit/8406656c555bff042b66cab2fe2a6becf23eb74d))

## [4.9.7](https://github.com/monygroupcorp/noema/compare/v4.9.6...v4.9.7) (2026-05-06)


### Bug Fixes

* enrich unhandled-rejection notices with chat title and reply context ([ab9fc48](https://github.com/monygroupcorp/noema/commit/ab9fc484f6cb368e588098509c22862c9e7c4a38))

## [4.9.6](https://github.com/monygroupcorp/noema/compare/v4.9.5...v4.9.6) (2026-05-04)


### Bug Fixes

* add baked-image spec and benchmark for VastAI cold-start experiment ([a093551](https://github.com/monygroupcorp/noema/commit/a093551c23d9f8fa36d52e8a50af4240ea35b783))
* VastAI offer search broken by select_cols and reliability column ([93a6436](https://github.com/monygroupcorp/noema/commit/93a64365dc1d0b4eac35d80171cb146a431cba9b))

## [4.9.5](https://github.com/monygroupcorp/noema/compare/v4.9.4...v4.9.5) (2026-04-15)


### Bug Fixes

* **spells:** bill spell steps by populating costRate metadata ([654dfd5](https://github.com/monygroupcorp/noema/commit/654dfd5b719391b38554e3d701d930bd8cb5ebfb))
* **spells:** bill spell steps by populating costRate metadata ([bff864e](https://github.com/monygroupcorp/noema/commit/bff864e629c0238ea88e071fb4f94223baf67610))

## [4.9.4](https://github.com/monygroupcorp/noema/compare/v4.9.3...v4.9.4) (2026-04-14)


### Bug Fixes

* **spells,canvas:** backfill exposed inputs and show all-optional schemas ([7d9cc89](https://github.com/monygroupcorp/noema/commit/7d9cc89249280047294b8374e5441a3efce61809))
* **spells:** route telegram cast prompt to sole exposed input ([0019f2a](https://github.com/monygroupcorp/noema/commit/0019f2a436a938cf5780dc3aaa54ce5461476f04))

## [4.9.3](https://github.com/monygroupcorp/noema/compare/v4.9.2...v4.9.3) (2026-04-14)


### Bug Fixes

* **workflow:** stop cross-field fan-out of step outputs in spells ([72b7099](https://github.com/monygroupcorp/noema/commit/72b709983f16afb24168b5e575ba8422b1b2cc0b))
* **workflow:** stop cross-field fan-out of step outputs in spells ([9a31490](https://github.com/monygroupcorp/noema/commit/9a3149057db35c796a2da9c9ca23315017e09cf3))

## [4.9.2](https://github.com/monygroupcorp/noema/compare/v4.9.1...v4.9.2) (2026-04-13)


### Bug Fixes

* **sandbox:** make primitive a real backend tool, drop passthrough trick ([e7ebfe4](https://github.com/monygroupcorp/noema/commit/e7ebfe44a1b7d2599824729ef75f5d2da9faf73e))
* **sandbox:** preserve expression and primitive nodes when composing spell ([370d4ac](https://github.com/monygroupcorp/noema/commit/370d4ac57bb8f803cc2bb3f9199cc68e679e7a08))
* **sandbox:** preserve primitives as first-class steps in composed spells ([b8df5ac](https://github.com/monygroupcorp/noema/commit/b8df5aca623d6c9b0723023473b49475742b2158))

## [4.9.1](https://github.com/monygroupcorp/noema/compare/v4.9.0...v4.9.1) (2026-04-13)


### Bug Fixes

* **sandbox:** allow native tap-and-hold to save output media on mobile ([69c9f71](https://github.com/monygroupcorp/noema/commit/69c9f71599bb9a570c76f845b124694eadf7c827))
* **sandbox:** show Compose Spell in mobile multi-select action bar ([c6d423b](https://github.com/monygroupcorp/noema/commit/c6d423bbdddba4b6c98faa145bbddb8760b9b390))

## [4.9.0](https://github.com/monygroupcorp/noema/compare/v4.8.2...v4.9.0) (2026-04-08)


### Features

* auto-create contributor reward indexes on application startup ([2aa29ee](https://github.com/monygroupcorp/noema/commit/2aa29eeca2b1955129ebbc5c4599346dc07513d0))
* contributor reward tally system with dashboard and model page surfacing ([16ae72a](https://github.com/monygroupcorp/noema/commit/16ae72a821451ad0c70314aade3178e587e996d5))

## [4.8.2](https://github.com/monygroupcorp/noema/compare/v4.8.1...v4.8.2) (2026-04-08)


### Bug Fixes

* write loraResolutionData to generation record via adapter async path ([ab69d62](https://github.com/monygroupcorp/noema/commit/ab69d62cfd7bbe137f6566a54cc251341922b1b0))

## [4.8.0](https://github.com/monygroupcorp/noema/compare/v4.7.3...v4.8.0) (2026-04-06)


### Features

* add _updateNode helper, seed 7 execution-state nodes, add running/error/censored canvas visuals ([01c3f95](https://github.com/monygroupcorp/noema/commit/01c3f954a862d7ac4ce1737555978a1c6c6a9c85))
* add 'fx' edit button on wired inputs to splice in expression nodes ([007491e](https://github.com/monygroupcorp/noema/commit/007491eaf7e48d47f5106c3ec235351ae1405262))
* add + FAB and ActionModal creation flow to FocusDemo ([ae5985f](https://github.com/monygroupcorp/noema/commit/ae5985ff13b6393ec242dab70e8b34e266a50d07))
* Add approval-based platform linking with anti-abuse protection ([6049cd1](https://github.com/monygroupcorp/noema/commit/6049cd187d4d7c89319cce32d6a2041525eebf01))
* add batch detection and fan-out execution pipeline ([a43b09b](https://github.com/monygroupcorp/noema/commit/a43b09be450b2609a41cc9433ae622119a1a61d3))
* add batch stack visual rendering with card depth and badge ([85dffec](https://github.com/monygroupcorp/noema/commit/85dffec16a071e64f59ecca720c7ead462e485cd))
* add Discord groupMenuManager component for server sponsorship ([5b12af4](https://github.com/monygroupcorp/noema/commit/5b12af495a77275ede3b49faa18e30798c534c61))
* add expr-eval dependency for expression nodes ([c0c9982](https://github.com/monygroupcorp/noema/commit/c0c9982202059a90c308288e6885633af42a4729))
* add expression backend adapter with expr-eval ([3354ee1](https://github.com/monygroupcorp/noema/commit/3354ee172abb70d54f56b8466053bfc968579f19))
* add expression evaluator utility with whitelisted functions ([f890212](https://github.com/monygroupcorp/noema/commit/f890212c2c8b288282014256849b2a3b464377f7))
* add expression node to action modal ([2a29151](https://github.com/monygroupcorp/noema/commit/2a29151fd794abbeb9f6a50706b172d629a2b69e))
* add expression NODE_MODE rendering with expression editor ([6701490](https://github.com/monygroupcorp/noema/commit/6701490f8e6418346b8ee3ec05081f3f184f6812))
* add expression tool definition to registry ([080a8f0](https://github.com/monygroupcorp/noema/commit/080a8f035bad57bf7d26482eb6649b7a1cf62a1e))
* add expression window creation and Z2 rendering ([95d0a26](https://github.com/monygroupcorp/noema/commit/95d0a26bf8b62b6fff211bfb2928fdc3dbf51238))
* add expression window type and batch output storage to CanvasEngine ([4e6f543](https://github.com/monygroupcorp/noema/commit/4e6f543befa95f8d2fe62f0e5fb4c43907683b22))
* add ffmpeg backend adapter with concat support and security limits ([772699a](https://github.com/monygroupcorp/noema/commit/772699af73e77c1bb659e5a369acfd684c20928f))
* add ffmpeg tool definition with concat mode ([00489b5](https://github.com/monygroupcorp/noema/commit/00489b5291673ca7b763eceafbdcf575fb2695f4))
* add findReferralVaultByKey, getReferralDashboardStats, update stats to use referral_key ([c8ec085](https://github.com/monygroupcorp/noema/commit/c8ec085717835e34918f7c4c911a1d04be52d9d5))
* add guild sponsorship check to Discord dynamic commands ([c43b2cb](https://github.com/monygroupcorp/noema/commit/c43b2cb6a85d1ea4485db8a9d43c09419a8ba7a4))
* add inline result preview to nodes + result card to NODE_MODE ([6f58c28](https://github.com/monygroupcorp/noema/commit/6f58c285e81baf0d6d8fe048aa7b40d792501258))
* add TWEAK_DEFAULTS config and wire zoom levels to live tweaks ([ecddf7f](https://github.com/monygroupcorp/noema/commit/ecddf7f75da95cb4aa8190a4b6f48ee5c792521f))
* after connection, center Z1 on target node instead of source ([cecbea2](https://github.com/monygroupcorp/noema/commit/cecbea21a7f89bf9d1c8b71270b32e37593f662d))
* allow type-mismatched connections with warning, add disconnect buttons in node mode ([46cb0a2](https://github.com/monygroupcorp/noema/commit/46cb0a247c4b5560264839896ac468d664208120))
* **api:** add batch API routes (start, status, zip, promote) ([f5381a3](https://github.com/monygroupcorp/noema/commit/f5381a35d3d20b948e67844e348959dc7fb94731))
* **auth:** AccountDropdown emits requireAuth instead of redirecting ([267887c](https://github.com/monygroupcorp/noema/commit/267887c63290b53a0b2e35ffc112592e621bac9d))
* **auth:** add AuthWidget persistent minimizable sign-in card ([01dec96](https://github.com/monygroupcorp/noema/commit/01dec968a9f6cbdd9a538f555e9d08bfaff40f1e))
* **auth:** add GET /auth/account-exists probe endpoint ([c50cb69](https://github.com/monygroupcorp/noema/commit/c50cb692a5653c735a82614e358c075753182318))
* **batch:** add BatchZipService for R2 zip assembly with 3-day TTL ([f0ecc1f](https://github.com/monygroupcorp/noema/commit/f0ecc1f791cb276777af7fd42f3b2117f4207722))
* **batch:** merge canvas batch mode to main ([7f87ce3](https://github.com/monygroupcorp/noema/commit/7f87ce3713dd1de5e837a3be0a53d50039864b1a))
* blue-green deploy — zero downtime container swap ([4b99abf](https://github.com/monygroupcorp/noema/commit/4b99abfed1869cebae3cfc84258463fb087d9d93))
* connection mode redesign — parallel overlay, per-port anchors, seeking badge, type-aware matching ([e0d42eb](https://github.com/monygroupcorp/noema/commit/e0d42eb9058a3e4d1fe944c5d4d0af65f26cb590))
* **cook:** add mode:batch support to CookOrchestratorService ([cc7f7b7](https://github.com/monygroupcorp/noema/commit/cc7f7b7644a948c0aa6cc3ace2f6d5f8a86925f8))
* **design:** ActionModal → SVG radial instrument menu, max 5 segments ([d8dfe91](https://github.com/monygroupcorp/noema/commit/d8dfe91d164fbf6d84c39f65e63ebda2a17a6a28))
* **design:** AuthWidget — instrument panel authentication UI, corner brackets ([93cb405](https://github.com/monygroupcorp/noema/commit/93cb40576d77d75aef9b2be48a94c4dc69a75f13))
* **design:** CostHUD — instrument panel readout, bottom-left, corner bracket ([ef8562d](https://github.com/monygroupcorp/noema/commit/ef8562d9d81fca180935605522d7ce4abe6676ab))
* **design:** CTA button — wipe-fill + glint scanline hover effects ([dde1cd2](https://github.com/monygroupcorp/noema/commit/dde1cd2c8fe527c4563b015358f978daff5cc72c))
* **design:** image overlay — panel extension, grid-visible, corner brackets ([9464aef](https://github.com/monygroupcorp/noema/commit/9464aef7a979753abc15eb31c309d18938763fbf))
* **design:** landing — ether instrument layout; docs header matches sandbox wordmark ([bf331dc](https://github.com/monygroupcorp/noema/commit/bf331dcec311db9266a58a814e994d6fa604aef3))
* **design:** landing multi-section, docs NOEMA header, pricing in docs ([22b78f4](https://github.com/monygroupcorp/noema/commit/22b78f4455ec5c1daf3eade66657ed6b62e21143))
* **design:** landing page — NOEMA wordmark, sigil watermark, minimal nav ([5277579](https://github.com/monygroupcorp/noema/commit/52775798851cca599e599651e2ab67d6e08ddd44))
* **design:** MintSpellFAB → flat instrument compose button, bottom-right ([0d526fa](https://github.com/monygroupcorp/noema/commit/0d526fa3c0a18628937448a95313e51be7e93112))
* **design:** modal system + specialized modal token alignment ([6c53a27](https://github.com/monygroupcorp/noema/commit/6c53a27f111367241df8c1f55fd34f3104130655))
* **design:** NOEMA Phase 0 foundation — fonts, design tokens, base layout ([420c7e3](https://github.com/monygroupcorp/noema/commit/420c7e3156137b35f1e04c8f8e7850d67e14f049))
* **design:** NOEMA Phase 1-3a — Sigil component, ether canvas grid, node window chrome ([5330741](https://github.com/monygroupcorp/noema/commit/53307410d29ad0a8a9ef182c45d4e633aa469e35))
* **design:** NOEMA Phase 3 — node window chrome, parameter form, result display ([3bc06ed](https://github.com/monygroupcorp/noema/commit/3bc06edf572c36cc15fddadcda099fe05a820fdd))
* **design:** NOEMA Phase 4+5 — connection signals, instrument header, sidebar dock ([fe38ce1](https://github.com/monygroupcorp/noema/commit/fe38ce199495eb1b386df64dbe5038f842e49fb3))
* **design:** remove legacy styles, align index.css with NOEMA design system ([8eee26c](https://github.com/monygroupcorp/noema/commit/8eee26c404ffcb3b649189baffce7c14e244a575))
* **design:** workspace tabs — instrument tab bar with accent active indicator ([b4f98b6](https://github.com/monygroupcorp/noema/commit/b4f98b6415632266dddd7c46f45ac61fb455ff77))
* **design:** WorkspaceTabs → collapsible dropdown dock, top-left, no emoji ([06fd221](https://github.com/monygroupcorp/noema/commit/06fd22136d3580fcdb3d6a1e1048bab6dbda4f29))
* **focus:** add CONNECTION_MODE to state machine ([eb37ac8](https://github.com/monygroupcorp/noema/commit/eb37ac84b1f5c4cac4ee8e4d10d2739e0614939f))
* **focus:** add MULTI_SELECT to state machine ([78c932b](https://github.com/monygroupcorp/noema/commit/78c932b10ac73100b48958497c102fceb953a166))
* **focus:** clone logic, batch operations, and version registry ([82d3f58](https://github.com/monygroupcorp/noema/commit/82d3f58dcffdf6619ff7c6dd833b696dc9a01f30))
* **focus:** connection mode UI with anchor picker ([ee8a041](https://github.com/monygroupcorp/noema/commit/ee8a0412ab2f66e6518a72287ca06b5023593571))
* **focus:** multi-select with long-press and action bar UI ([dd3d685](https://github.com/monygroupcorp/noema/commit/dd3d68514c67180b70c79b2d50a80a5ab29f4cfc))
* **focus:** Phase 1 spatial foundation — physics engine, demo page, 43 tests ([2c7a711](https://github.com/monygroupcorp/noema/commit/2c7a7115189ea3e1a5abc4cae8c4318ce03c3c44))
* **focus:** polish HUD and control panel for new states ([efba538](https://github.com/monygroupcorp/noema/commit/efba5388f674cc61b731db6f3dccd6cfbffcb608))
* **focus:** render anchor squares on canvas nodes ([6e7e9e7](https://github.com/monygroupcorp/noema/commit/6e7e9e7ac251a94af0b847799a9bbae0afcfea39))
* **focus:** wire gestures for connection mode and multi-select ([5348fa5](https://github.com/monygroupcorp/noema/commit/5348fa5634bebe679c7abb3a799e138d38583268))
* image lightbox, copy feedback on text overlay, clickable node-mode images ([4fe42f8](https://github.com/monygroupcorp/noema/commit/4fe42f89a6407bfa768ea8e568be17a53c8be6b3))
* improved expression NODE_MODE with contextual hints, result preview, and collapsible reference ([55719f3](https://github.com/monygroupcorp/noema/commit/55719f3cd1c886a25d1e933f62320352dea35335))
* **internal-api:** add batch start/status/zip/promote routes to internal cook API ([f6c43f8](https://github.com/monygroupcorp/noema/commit/f6c43f8b4e64d3660b7e23eec05da9f177ab95ab))
* **landing:** CTA navigates to app subdomain, remove AuthModal ([55ea582](https://github.com/monygroupcorp/noema/commit/55ea5824bcb37c9a0bfa1a5a7cfd067ba5469d80))
* make groups API platform-aware for Discord sponsorship support ([9464edd](https://github.com/monygroupcorp/noema/commit/9464edd6638f2a6d141316519637e6c12b879d15))
* momentum pan with ring-buffer velocity and tap-to-kill ([b5686c6](https://github.com/monygroupcorp/noema/commit/b5686c6f464c7b5920ddfe932e01e3b1f82ce1a3))
* multi-line expression support — each line pipes result as input to the next ([1d8c6d0](https://github.com/monygroupcorp/noema/commit/1d8c6d077d1d9b6d0ca88c62b54420f597bea976))
* only required input anchors visible in Z1/Z2, optional via node mode only ([c927658](https://github.com/monygroupcorp/noema/commit/c9276584e48ea3eb760e74108a8738140562509f))
* pass live tweaks to physics step and force functions ([acf2f21](https://github.com/monygroupcorp/noema/commit/acf2f21f0dcc38b8dbdc4432f231eb1c97008028))
* periodic memory reporter to Telegram feedback chat ([e8efda1](https://github.com/monygroupcorp/noema/commit/e8efda14b599a05474da73e67f56b8bbb8c0461f))
* referral code registration, cookie-based purchase attribution, and EXP gate ([6581163](https://github.com/monygroupcorp/noema/commit/6581163045b9917fb6ca21d109a5efd3495d187e))
* register groupsettings command and groupMenuManager in Discord bot ([41bb1c6](https://github.com/monygroupcorp/noema/commit/41bb1c6e0f45c2579a5b64f7abfd611998891241))
* replace CONNECTION_MODE state with parallel connection overlay on FSM ([018d9f9](https://github.com/monygroupcorp/noema/commit/018d9f90b2034e6acace2dc2b0a67d457bb85f12))
* **sandbox:** new boot flow — EIP-6963 detection, account-exists probe, AuthWidget ([10d6377](https://github.com/monygroupcorp/noema/commit/10d63771262a0bdeed8ddd017ace1180e867705e))
* **spells:** migrate spell execution page to microact SPA ([8f70426](https://github.com/monygroupcorp/noema/commit/8f7042656e1937db2ff892c7f307d01aa80529c8))
* startup announcement and memory monitor with 768MB cap ([98877a4](https://github.com/monygroupcorp/noema/commit/98877a4296e8a51f8dfdae73848d3d3051b1abe7))
* swipe-to-zoom zone, zoomIn FSM method, tweaker drawer UI + CSS, fix momentum scaling ([aacf533](https://github.com/monygroupcorp/noema/commit/aacf533fabae37eab82d2a61a1bcc28d49d81063))
* text result as clickable block with overlay, spell shows last result image ([2c16137](https://github.com/monygroupcorp/noema/commit/2c161373714e2ae389d5b8fe772e894e9a358b3d))
* **training:** add embellishment pre-flight dialog for captions and control images ([ead88a8](https://github.com/monygroupcorp/noema/commit/ead88a853add7019158155cb4d1e1d015d6fb2a8))
* typed SVG anchor icons, required/optional param split with toggle in node mode ([3498fcb](https://github.com/monygroupcorp/noema/commit/3498fcbe5afac8832d5b1dac042714015bb7d2f3))
* **ui:** add BatchPanel bottom-sheet component ([d237404](https://github.com/monygroupcorp/noema/commit/d237404b5c7624607994b91aef8663a211c87d13))
* **ui:** scale all font sizes 20% larger across sandbox and site ([d139db0](https://github.com/monygroupcorp/noema/commit/d139db0556cd8225c91e13e075c940bf6df2a9aa))
* **ui:** trigger BatchPanel from multi-image upload drop ([3e933db](https://github.com/monygroupcorp/noema/commit/3e933db9067ad87ee07bd73345aa8004d96cea34))
* **ux:** close any modal/overlay on Escape key ([fca8cae](https://github.com/monygroupcorp/noema/commit/fca8caed3aba39d6ed642f0ffc32a7a9ebf3b886))
* wire expression node client-side execution with array-to-batch support ([72e505a](https://github.com/monygroupcorp/noema/commit/72e505a592ad69dd10190233d25ee8d77c18a627))
* workflow auto-refresh every 6h + release.sh helper ([555751b](https://github.com/monygroupcorp/noema/commit/555751bcf51631729959e6b87c94a2c871110069))


### Bug Fixes

* add expr-eval to frontend package.json for Docker build ([0289c74](https://github.com/monygroupcorp/noema/commit/0289c748a84f8c2b2074575be747db929c9a72bc))
* add openssh-client to Docker image for VastAI SSH transport ([3fca152](https://github.com/monygroupcorp/noema/commit/3fca15235d6142ad7b7add9b9c5567d3c70c5515))
* admin middleware ethereumServices ref, remove custody reads, ALCHEMY_API_KEY migration ([014c4d4](https://github.com/monygroupcorp/noema/commit/014c4d43d07be457d02acfed42f4f49568274d69))
* **auth:** AuthWidget stable render + centered modal + AccountDropdown re-fetch on auth:success ([bade237](https://github.com/monygroupcorp/noema/commit/bade237bfff6864ed542bb49a2cc430b7ffed0f8))
* **auth:** cookie domain, wallet picker, logout redirect, wallet-only UI ([7ecc33e](https://github.com/monygroupcorp/noema/commit/7ecc33ecdaba2eb0e47849579c43cbcc8c459b77))
* **auth:** SPA shell is public, remove HTML redirect to /landing ([9667008](https://github.com/monygroupcorp/noema/commit/96670084c82beda34f8ff40496c9ab06757a91ef))
* auto-rebase before push in release.sh to avoid rejected pushes ([4dd7a86](https://github.com/monygroupcorp/noema/commit/4dd7a86e8fd8586ffa27c835fd381776398dd358))
* **batch:** fix upload URL passthrough, reduce poll frequency, handle race conditions ([996378d](https://github.com/monygroupcorp/noema/commit/996378dcb2e6d282d77fd0ea16713f7110edcfdd))
* **batch:** use exports bucket for batch zip storage ([042cda4](https://github.com/monygroupcorp/noema/commit/042cda4390c4d0515e2685a2a3a237b8da2bae5d))
* caddy reload crash on bind-mounted Caddyfile ([3e9607d](https://github.com/monygroupcorp/noema/commit/3e9607d4182b0ca492022b686992fe746b5c4f8c))
* canvas2 expression node system — batch, persistence, overlay nav ([dfeceb9](https://github.com/monygroupcorp/noema/commit/dfeceb9988baf8bdd1c8dfd9444020ef7bb28516))
* captions from embellishments not reaching training ([40b3847](https://github.com/monygroupcorp/noema/commit/40b3847d736c7935ac2725980830ed27d93420bb))
* chain docker build into release-please workflow ([cc0ab24](https://github.com/monygroupcorp/noema/commit/cc0ab24965b51bfccc2b88de8e54b68358f1ad81))
* clear pending updates on startup and filter pre-startup messages only ([7dcf53f](https://github.com/monygroupcorp/noema/commit/7dcf53f9b08eb69764d9a24b1861d5a5ff8af434))
* correct relative path in logsApi after moving out of logs/ subdir ([2d322fc](https://github.com/monygroupcorp/noema/commit/2d322fc00067fcaf466fd19b308bcd7256788c18))
* create logs directory in Docker image for winston ([3350fec](https://github.com/monygroupcorp/noema/commit/3350fec9d952900a6b58713b3b649bdcd912c732))
* **dalle:** upload generations to exports bucket instead of uploads ([fcc30b2](https://github.com/monygroupcorp/noema/commit/fcc30b22ac8980891d1c128a9dae3bf9b264e660))
* dataset edit form now saves uploaded images and styles file input ([cfd6656](https://github.com/monygroupcorp/noema/commit/cfd66569915433397be7c9949a9e131247429cf1))
* deploy script aborted before container rename when no shutdown logs matched grep ([a0aca88](https://github.com/monygroupcorp/noema/commit/a0aca88b37aa7e21d92f1a086df72c0905e6d375))
* **design:** proper isometric grid — JS-computed background-size/position tracks viewport, iso period scales with zoom ([50f98b9](https://github.com/monygroupcorp/noema/commit/50f98b9ff04449ec78c8e60d38fcf79134e109c3))
* **dev:** point Vite publicDir at root public/ so /docs/* is served in dev ([f4f06d5](https://github.com/monygroupcorp/noema/commit/f4f06d54efeec1fa534313b3ce5d6da390aee7f6))
* direct window.ethereum fallback for ethOS injected wallet ([a25f98a](https://github.com/monygroupcorp/noema/commit/a25f98ac8f3b2b038b1223bdec0fda3287a4a5f4))
* **docs:** load /index.css on mount so NOEMA CSS variables are defined ([314fb6a](https://github.com/monygroupcorp/noema/commit/314fb6ad57665d71ee150cabcbad684f8aec73db))
* downgrade vitest to 3.2.4 for vite 5 compatibility ([28bb8ed](https://github.com/monygroupcorp/noema/commit/28bb8eda54e760660d85bab87e67add29c8a55ab))
* eliminate momentum overroll by removing setState from tick loop ([0f22b83](https://github.com/monygroupcorp/noema/commit/0f22b8384ebb265657d187052b31016e0676cbcf))
* enable contributor reward distribution for model trainers and spell authors ([1fd7b6b](https://github.com/monygroupcorp/noema/commit/1fd7b6bd823e116f56c4caecbc21a688e1d24c8d))
* expression node — execute button, always-visible anchors, delete-reconnect ([e246398](https://github.com/monygroupcorp/noema/commit/e24639873cf1461ebb6dcc6806ac8c25891bf80c))
* expression node serialization for workspace save/load, anchors Z1 only ([768eee5](https://github.com/monygroupcorp/noema/commit/768eee59ac562df0695a60899ce713be324b1e16))
* extend SSH auth timeout to 5min and increase offer retries to 5 ([931f5cf](https://github.com/monygroupcorp/noema/commit/931f5cfeadb02e5c4b3cdb976dc3d2c8a469fbcc))
* fast-fail SSH auth on repeated Permission denied (publickey) ([341e510](https://github.com/monygroupcorp/noema/commit/341e5100cc93fbdcb2de8dfbe98594e5fab94762))
* fetch full git history in CI so commit info resolves correctly ([85ba0d0](https://github.com/monygroupcorp/noema/commit/85ba0d0553bc40f034c0c6d95d2237870fa5530b))
* fetch full tool schemas from /registry, tap-to-cancel connection on touch ([c798685](https://github.com/monygroupcorp/noema/commit/c7986858e1572b4afbf440ca8b4a83a25daecdc8))
* fetch wallet balances via server RPC, not wallet provider ([46bb58f](https://github.com/monygroupcorp/noema/commit/46bb58f4353b9b0c3700a19c6f5cbfaec0659363))
* filter out multi-GPU instances from VastAI offer search ([7386c50](https://github.com/monygroupcorp/noema/commit/7386c504e7b5609117256e7be5e9c63dd868b08f))
* finalize referral system migration to CreditVault native model ([1e5e228](https://github.com/monygroupcorp/noema/commit/1e5e228aff7beae8a1a08c16ff63b119da4eba7e))
* fortify Telegram polling and setupCommands initialization ([1b779ab](https://github.com/monygroupcorp/noema/commit/1b779abee7fcc66d2aa6b7d6e3f082bff28e0b0b))
* GPU preflight check fails when Accelerator() prints to stdout ([e5fae5b](https://github.com/monygroupcorp/noema/commit/e5fae5bff04bc4c7e480c6a12847c2ca1cf3ed88))
* hold _momentumPanX until next pan so async setState snap cannot occur ([fac262d](https://github.com/monygroupcorp/noema/commit/fac262de2057784c5d89871bafc7857348aaeafc))
* image overlay uses header bar for close button, reliable on mobile ([bb85aff](https://github.com/monygroupcorp/noema/commit/bb85affc89642ec15ac57e70f788ca288e4d999c))
* import getCreditVaultAddress at module scope for SpellPaymentService ([2ea0718](https://github.com/monygroupcorp/noema/commit/2ea0718a7dd2d346e2d073fdc5cd06b51bae9db8))
* intercept tap on result zones to open overlay instead of navigating node ([611cc98](https://github.com/monygroupcorp/noema/commit/611cc98891f960dd44c5659e113890392c504c80))
* **landing:** remove Nav chrome, align tagline to condensed uppercase to match header ([70d71fe](https://github.com/monygroupcorp/noema/commit/70d71fe6fdb7d29875c71a74270dfa447ef01ac2))
* log errors from startup announcement and memory monitor sends ([f6ae96b](https://github.com/monygroupcorp/noema/commit/f6ae96b775c04c937745dcc6b91a1766da416389))
* memory drop alert only fires after a warning or critical, not on normal GC ([288403f](https://github.com/monygroupcorp/noema/commit/288403f9541e61df1f17304387cb8b47d56ee140))
* **mobile:** docs sidebar drawer + landing capabilities stack on narrow screens ([cdc7dcc](https://github.com/monygroupcorp/noema/commit/cdc7dcc98a3a24579fb61128d799241a1975d90e))
* more robust telegram client; group points fixed ([366d91b](https://github.com/monygroupcorp/noema/commit/366d91ba87537e0e501112755420ba3f80c40b33))
* move logsApi out of gitignored logs/ directory ([bc1c516](https://github.com/monygroupcorp/noema/commit/bc1c5162e561289dd14397ffbe728a4b75e94a03))
* move workflow auto-refresh into WorkflowCacheManager, revert app/discord changes ([996e4b8](https://github.com/monygroupcorp/noema/commit/996e4b81e42891d75381dfe066642c6a05b7fbc9))
* move workflow refresh interval to after full startup ([e30b262](https://github.com/monygroupcorp/noema/commit/e30b262948d24c0a618b83c1467cdfd9768d91ab))
* **nav:** use getAppUrl() instead of hardcoded app URL ([90b532f](https://github.com/monygroupcorp/noema/commit/90b532f198db8da0f7a6a132f04595247ccf4ec2))
* partial recovery falsely marked failed; add GPU/cost to training card ([c038281](https://github.com/monygroupcorp/noema/commit/c03828108642a4fa7d8d304f746d80baa9f68d50))
* **radial:** center on click point, fix dismiss guard for new class names ([de2bf83](https://github.com/monygroupcorp/noema/commit/de2bf83ae1e5eaad528c3e54d11d58b9fd056313))
* **radial:** tools view → scrollable panel showing all tools, radial only for root/categories ([713644e](https://github.com/monygroupcorp/noema/commit/713644e7bb0c4b61816dc8feccb5efd927895954))
* registry-based deploy pipeline ([14bd484](https://github.com/monygroupcorp/noema/commit/14bd484ad4c7f816d4ddcc31cb3d42977a8593dd))
* release.sh polls for release-please PR instead of fixed delay ([cdebe4c](https://github.com/monygroupcorp/noema/commit/cdebe4c33ae168814cbd77fe3a22bd5455993bce))
* revert deleteWebhook change, restore original polling startup ([e297345](https://github.com/monygroupcorp/noema/commit/e297345d9be8458a95f189a5890532d7111e8770))
* revert elapsed cap, add generation counter to kill stale momentum ticks ([3b9aa14](https://github.com/monygroupcorp/noema/commit/3b9aa14a6f9f09a6daf4d41c48623c9af929b0f6))
* **sandbox:** use spell: prefix for spell toolIds, normalize legacy spell- prefix ([dd79bc3](https://github.com/monygroupcorp/noema/commit/dd79bc38bdedb6befbe69113c2de03f070f18b03))
* scope sample image search to samples dir and sample at final step ([73ae391](https://github.com/monygroupcorp/noema/commit/73ae39140f1eac4eb86044458ef7c48a101cdd72))
* search all GPU types upfront and fall through on SSH failure ([2691665](https://github.com/monygroupcorp/noema/commit/2691665d8c8d5c866643137c9fcb11713bdf2fd4))
* seed demo nodes directly on mount instead of loading API tools ([eaa993e](https://github.com/monygroupcorp/noema/commit/eaa993e79f95c296ba0ca46656a2e2f806f3e753))
* settings apiFetchLimit ReferenceError and 402 insufficient funds message ([e3e62c4](https://github.com/monygroupcorp/noema/commit/e3e62c4fabc07d01f837c286622351463edf18d0))
* **sidebar:** restore sandbox-sidebar compat class, move sb-handle outside overflow:hidden aside ([f6a4778](https://github.com/monygroupcorp/noema/commit/f6a4778ee80540a5da5aa96d020b27cf11ddcd32))
* skip exhausted VastAI offers across job retries ([ffd6937](https://github.com/monygroupcorp/noema/commit/ffd69379d6b3ee2c34388364628f626699f6bf26))
* sort VastAI offers by reliability first, then price ([beb1ea2](https://github.com/monygroupcorp/noema/commit/beb1ea25b5bca7cb57f43fc909ca8b577b8ebabf))
* spell last step is image, fix seed step order ([5294e5c](https://github.com/monygroupcorp/noema/commit/5294e5c726e07a8965d9fa266940b56715ea0aeb))
* **spells:** map usageCount to uses in marketplace API response ([777c1f0](https://github.com/monygroupcorp/noema/commit/777c1f09b19708232f120ac26fb4025dc693d259))
* stack node mode params columns vertically on mobile ([227efd8](https://github.com/monygroupcorp/noema/commit/227efd893aa3aceb6c8226358c69ec1c82a78b76))
* startup message shows correct commit and stationthisbot name ([63a725b](https://github.com/monygroupcorp/noema/commit/63a725bca2bb9168fffa49a02c4b03c2f4731f6a))
* stop polling on 429 and skip polling when WS is connected ([ccad421](https://github.com/monygroupcorp/noema/commit/ccad421e5ade825679ea3bd86738e3d2ed03c5c5))
* stop Telegram polling on graceful shutdown to prevent blue-green 409 conflict ([99d8cd1](https://github.com/monygroupcorp/noema/commit/99d8cd1013cd451db6808ce2706057d1f5830715))
* telegram tools detail view and delivery menu info button ([adacf3d](https://github.com/monygroupcorp/noema/commit/adacf3d908d63a05b12c4e39f9f14b957e818a70))
* timeout wallet balance fetches, don't block payment flow ([0926339](https://github.com/monygroupcorp/noema/commit/09263396e54b168b8482e04d40b36886f03ea277))
* **training:** read caption sets from ds.embellishments instead of legacy /captions endpoint ([ce0ca75](https://github.com/monygroupcorp/noema/commit/ce0ca750d0680ce42d3f8718026076dcfcf232cf))
* treat staging subdomain as app subdomain, skip landing page redirect ([e070355](https://github.com/monygroupcorp/noema/commit/e070355ba1ecaeada2ef3f5fd83c27d1510f9041))
* tweaker tab tappable, no overroll snap on momentum stop ([b62d4b3](https://github.com/monygroupcorp/noema/commit/b62d4b3b9a063cf6997b6f72c5bebe1c64f2a20f))
* type anchor-connectable inputs/outputs across demo tools (text, video) ([023c385](https://github.com/monygroupcorp/noema/commit/023c3854e23e1808ae6c0c4cf499f3506eec4f35))
* type dalle output as image, prompt input as text for anchor type system ([a197aa4](https://github.com/monygroupcorp/noema/commit/a197aa48dd5bef7026f63d7f94469e3edada15c3))
* **ui:** restore tool window chrome CSS, fix account dropdown mobile overflow ([61909f0](https://github.com/monygroupcorp/noema/commit/61909f05290366dc23f2459a76491d246d39c766))
* unify magic amount generation and cap at 7 decimal places ([bb802d1](https://github.com/monygroupcorp/noema/commit/bb802d1ceffd89ac1781c8415477c66aa2c52f60))
* update VaultModal for on-chain referral registration, fix check-name 404, filter legacy vaults ([f1bd715](https://github.com/monygroupcorp/noema/commit/f1bd715933842291f33c6f55095bd4234e68ddd0))
* **upload:** add multiple attribute to file input for batch selection ([0fa2206](https://github.com/monygroupcorp/noema/commit/0fa2206f49dc646a57935b33bea539861879513d))
* **upload:** proxy upload through server to bypass R2 CORS; redesign upload node UX ([8725f33](https://github.com/monygroupcorp/noema/commit/8725f332f4715b8264c40288a740d1323cc2515c))
* **upload:** use imperative file input for reliable multiple selection ([a54504c](https://github.com/monygroupcorp/noema/commit/a54504c4555cf5d9ab01d563751b1f980d637fd7))
* **upload:** use visible file input like TrainingStudio for reliable multi-select ([be5d71f](https://github.com/monygroupcorp/noema/commit/be5d71f708aaec06d9bb35290120a86296109b72))
* use vitest 2.1.9 — no nested vite 7, clean @types/node resolution ([836b7dd](https://github.com/monygroupcorp/noema/commit/836b7dd5169fb3a762289641b43b0283099d511d))
* wallet connect for ethOS smart contract wallets ([328d233](https://github.com/monygroupcorp/noema/commit/328d2334ed31e4db8d965b909cc10a1fbb418310))


### Performance Improvements

* add SSH ControlMaster multiplexing to SshTransport ([58c7b77](https://github.com/monygroupcorp/noema/commit/58c7b770f87200ea476c9e59696eec04036109e4))

## [4.7.3](https://github.com/monygroupcorp/noema/compare/v4.7.2...v4.7.3) (2026-03-30)


### Bug Fixes

* fetch wallet balances via server RPC, not wallet provider ([46bb58f](https://github.com/monygroupcorp/noema/commit/46bb58f4353b9b0c3700a19c6f5cbfaec0659363))

## [4.7.2](https://github.com/monygroupcorp/noema/compare/v4.7.1...v4.7.2) (2026-03-29)


### Bug Fixes

* timeout wallet balance fetches, don't block payment flow ([0926339](https://github.com/monygroupcorp/noema/commit/09263396e54b168b8482e04d40b36886f03ea277))

## [4.7.1](https://github.com/monygroupcorp/noema/compare/v4.7.0...v4.7.1) (2026-03-29)


### Bug Fixes

* stack node mode params columns vertically on mobile ([227efd8](https://github.com/monygroupcorp/noema/commit/227efd893aa3aceb6c8226358c69ec1c82a78b76))

## [4.7.0](https://github.com/monygroupcorp/noema/compare/v4.6.18...v4.7.0) (2026-03-29)


### Features

* add _updateNode helper, seed 7 execution-state nodes, add running/error/censored canvas visuals ([01c3f95](https://github.com/monygroupcorp/noema/commit/01c3f954a862d7ac4ce1737555978a1c6c6a9c85))
* add 'fx' edit button on wired inputs to splice in expression nodes ([007491e](https://github.com/monygroupcorp/noema/commit/007491eaf7e48d47f5106c3ec235351ae1405262))
* add + FAB and ActionModal creation flow to FocusDemo ([ae5985f](https://github.com/monygroupcorp/noema/commit/ae5985ff13b6393ec242dab70e8b34e266a50d07))
* Add approval-based platform linking with anti-abuse protection ([6049cd1](https://github.com/monygroupcorp/noema/commit/6049cd187d4d7c89319cce32d6a2041525eebf01))
* add batch detection and fan-out execution pipeline ([a43b09b](https://github.com/monygroupcorp/noema/commit/a43b09be450b2609a41cc9433ae622119a1a61d3))
* add batch stack visual rendering with card depth and badge ([85dffec](https://github.com/monygroupcorp/noema/commit/85dffec16a071e64f59ecca720c7ead462e485cd))
* add Discord groupMenuManager component for server sponsorship ([5b12af4](https://github.com/monygroupcorp/noema/commit/5b12af495a77275ede3b49faa18e30798c534c61))
* add expr-eval dependency for expression nodes ([c0c9982](https://github.com/monygroupcorp/noema/commit/c0c9982202059a90c308288e6885633af42a4729))
* add expression backend adapter with expr-eval ([3354ee1](https://github.com/monygroupcorp/noema/commit/3354ee172abb70d54f56b8466053bfc968579f19))
* add expression evaluator utility with whitelisted functions ([f890212](https://github.com/monygroupcorp/noema/commit/f890212c2c8b288282014256849b2a3b464377f7))
* add expression node to action modal ([2a29151](https://github.com/monygroupcorp/noema/commit/2a29151fd794abbeb9f6a50706b172d629a2b69e))
* add expression NODE_MODE rendering with expression editor ([6701490](https://github.com/monygroupcorp/noema/commit/6701490f8e6418346b8ee3ec05081f3f184f6812))
* add expression tool definition to registry ([080a8f0](https://github.com/monygroupcorp/noema/commit/080a8f035bad57bf7d26482eb6649b7a1cf62a1e))
* add expression window creation and Z2 rendering ([95d0a26](https://github.com/monygroupcorp/noema/commit/95d0a26bf8b62b6fff211bfb2928fdc3dbf51238))
* add expression window type and batch output storage to CanvasEngine ([4e6f543](https://github.com/monygroupcorp/noema/commit/4e6f543befa95f8d2fe62f0e5fb4c43907683b22))
* add ffmpeg backend adapter with concat support and security limits ([772699a](https://github.com/monygroupcorp/noema/commit/772699af73e77c1bb659e5a369acfd684c20928f))
* add ffmpeg tool definition with concat mode ([00489b5](https://github.com/monygroupcorp/noema/commit/00489b5291673ca7b763eceafbdcf575fb2695f4))
* add findReferralVaultByKey, getReferralDashboardStats, update stats to use referral_key ([c8ec085](https://github.com/monygroupcorp/noema/commit/c8ec085717835e34918f7c4c911a1d04be52d9d5))
* add guild sponsorship check to Discord dynamic commands ([c43b2cb](https://github.com/monygroupcorp/noema/commit/c43b2cb6a85d1ea4485db8a9d43c09419a8ba7a4))
* add inline result preview to nodes + result card to NODE_MODE ([6f58c28](https://github.com/monygroupcorp/noema/commit/6f58c285e81baf0d6d8fe048aa7b40d792501258))
* add TWEAK_DEFAULTS config and wire zoom levels to live tweaks ([ecddf7f](https://github.com/monygroupcorp/noema/commit/ecddf7f75da95cb4aa8190a4b6f48ee5c792521f))
* after connection, center Z1 on target node instead of source ([cecbea2](https://github.com/monygroupcorp/noema/commit/cecbea21a7f89bf9d1c8b71270b32e37593f662d))
* allow type-mismatched connections with warning, add disconnect buttons in node mode ([46cb0a2](https://github.com/monygroupcorp/noema/commit/46cb0a247c4b5560264839896ac468d664208120))
* **api:** add batch API routes (start, status, zip, promote) ([f5381a3](https://github.com/monygroupcorp/noema/commit/f5381a35d3d20b948e67844e348959dc7fb94731))
* **auth:** AccountDropdown emits requireAuth instead of redirecting ([267887c](https://github.com/monygroupcorp/noema/commit/267887c63290b53a0b2e35ffc112592e621bac9d))
* **auth:** add AuthWidget persistent minimizable sign-in card ([01dec96](https://github.com/monygroupcorp/noema/commit/01dec968a9f6cbdd9a538f555e9d08bfaff40f1e))
* **auth:** add GET /auth/account-exists probe endpoint ([c50cb69](https://github.com/monygroupcorp/noema/commit/c50cb692a5653c735a82614e358c075753182318))
* **batch:** add BatchZipService for R2 zip assembly with 3-day TTL ([f0ecc1f](https://github.com/monygroupcorp/noema/commit/f0ecc1f791cb276777af7fd42f3b2117f4207722))
* **batch:** merge canvas batch mode to main ([7f87ce3](https://github.com/monygroupcorp/noema/commit/7f87ce3713dd1de5e837a3be0a53d50039864b1a))
* blue-green deploy — zero downtime container swap ([4b99abf](https://github.com/monygroupcorp/noema/commit/4b99abfed1869cebae3cfc84258463fb087d9d93))
* connection mode redesign — parallel overlay, per-port anchors, seeking badge, type-aware matching ([e0d42eb](https://github.com/monygroupcorp/noema/commit/e0d42eb9058a3e4d1fe944c5d4d0af65f26cb590))
* **cook:** add mode:batch support to CookOrchestratorService ([cc7f7b7](https://github.com/monygroupcorp/noema/commit/cc7f7b7644a948c0aa6cc3ace2f6d5f8a86925f8))
* **design:** ActionModal → SVG radial instrument menu, max 5 segments ([d8dfe91](https://github.com/monygroupcorp/noema/commit/d8dfe91d164fbf6d84c39f65e63ebda2a17a6a28))
* **design:** AuthWidget — instrument panel authentication UI, corner brackets ([93cb405](https://github.com/monygroupcorp/noema/commit/93cb40576d77d75aef9b2be48a94c4dc69a75f13))
* **design:** CostHUD — instrument panel readout, bottom-left, corner bracket ([ef8562d](https://github.com/monygroupcorp/noema/commit/ef8562d9d81fca180935605522d7ce4abe6676ab))
* **design:** CTA button — wipe-fill + glint scanline hover effects ([dde1cd2](https://github.com/monygroupcorp/noema/commit/dde1cd2c8fe527c4563b015358f978daff5cc72c))
* **design:** image overlay — panel extension, grid-visible, corner brackets ([9464aef](https://github.com/monygroupcorp/noema/commit/9464aef7a979753abc15eb31c309d18938763fbf))
* **design:** landing — ether instrument layout; docs header matches sandbox wordmark ([bf331dc](https://github.com/monygroupcorp/noema/commit/bf331dcec311db9266a58a814e994d6fa604aef3))
* **design:** landing multi-section, docs NOEMA header, pricing in docs ([22b78f4](https://github.com/monygroupcorp/noema/commit/22b78f4455ec5c1daf3eade66657ed6b62e21143))
* **design:** landing page — NOEMA wordmark, sigil watermark, minimal nav ([5277579](https://github.com/monygroupcorp/noema/commit/52775798851cca599e599651e2ab67d6e08ddd44))
* **design:** MintSpellFAB → flat instrument compose button, bottom-right ([0d526fa](https://github.com/monygroupcorp/noema/commit/0d526fa3c0a18628937448a95313e51be7e93112))
* **design:** modal system + specialized modal token alignment ([6c53a27](https://github.com/monygroupcorp/noema/commit/6c53a27f111367241df8c1f55fd34f3104130655))
* **design:** NOEMA Phase 0 foundation — fonts, design tokens, base layout ([420c7e3](https://github.com/monygroupcorp/noema/commit/420c7e3156137b35f1e04c8f8e7850d67e14f049))
* **design:** NOEMA Phase 1-3a — Sigil component, ether canvas grid, node window chrome ([5330741](https://github.com/monygroupcorp/noema/commit/53307410d29ad0a8a9ef182c45d4e633aa469e35))
* **design:** NOEMA Phase 3 — node window chrome, parameter form, result display ([3bc06ed](https://github.com/monygroupcorp/noema/commit/3bc06edf572c36cc15fddadcda099fe05a820fdd))
* **design:** NOEMA Phase 4+5 — connection signals, instrument header, sidebar dock ([fe38ce1](https://github.com/monygroupcorp/noema/commit/fe38ce199495eb1b386df64dbe5038f842e49fb3))
* **design:** remove legacy styles, align index.css with NOEMA design system ([8eee26c](https://github.com/monygroupcorp/noema/commit/8eee26c404ffcb3b649189baffce7c14e244a575))
* **design:** workspace tabs — instrument tab bar with accent active indicator ([b4f98b6](https://github.com/monygroupcorp/noema/commit/b4f98b6415632266dddd7c46f45ac61fb455ff77))
* **design:** WorkspaceTabs → collapsible dropdown dock, top-left, no emoji ([06fd221](https://github.com/monygroupcorp/noema/commit/06fd22136d3580fcdb3d6a1e1048bab6dbda4f29))
* **focus:** add CONNECTION_MODE to state machine ([eb37ac8](https://github.com/monygroupcorp/noema/commit/eb37ac84b1f5c4cac4ee8e4d10d2739e0614939f))
* **focus:** add MULTI_SELECT to state machine ([78c932b](https://github.com/monygroupcorp/noema/commit/78c932b10ac73100b48958497c102fceb953a166))
* **focus:** clone logic, batch operations, and version registry ([82d3f58](https://github.com/monygroupcorp/noema/commit/82d3f58dcffdf6619ff7c6dd833b696dc9a01f30))
* **focus:** connection mode UI with anchor picker ([ee8a041](https://github.com/monygroupcorp/noema/commit/ee8a0412ab2f66e6518a72287ca06b5023593571))
* **focus:** multi-select with long-press and action bar UI ([dd3d685](https://github.com/monygroupcorp/noema/commit/dd3d68514c67180b70c79b2d50a80a5ab29f4cfc))
* **focus:** Phase 1 spatial foundation — physics engine, demo page, 43 tests ([2c7a711](https://github.com/monygroupcorp/noema/commit/2c7a7115189ea3e1a5abc4cae8c4318ce03c3c44))
* **focus:** polish HUD and control panel for new states ([efba538](https://github.com/monygroupcorp/noema/commit/efba5388f674cc61b731db6f3dccd6cfbffcb608))
* **focus:** render anchor squares on canvas nodes ([6e7e9e7](https://github.com/monygroupcorp/noema/commit/6e7e9e7ac251a94af0b847799a9bbae0afcfea39))
* **focus:** wire gestures for connection mode and multi-select ([5348fa5](https://github.com/monygroupcorp/noema/commit/5348fa5634bebe679c7abb3a799e138d38583268))
* image lightbox, copy feedback on text overlay, clickable node-mode images ([4fe42f8](https://github.com/monygroupcorp/noema/commit/4fe42f89a6407bfa768ea8e568be17a53c8be6b3))
* improved expression NODE_MODE with contextual hints, result preview, and collapsible reference ([55719f3](https://github.com/monygroupcorp/noema/commit/55719f3cd1c886a25d1e933f62320352dea35335))
* **internal-api:** add batch start/status/zip/promote routes to internal cook API ([f6c43f8](https://github.com/monygroupcorp/noema/commit/f6c43f8b4e64d3660b7e23eec05da9f177ab95ab))
* **landing:** CTA navigates to app subdomain, remove AuthModal ([55ea582](https://github.com/monygroupcorp/noema/commit/55ea5824bcb37c9a0bfa1a5a7cfd067ba5469d80))
* make groups API platform-aware for Discord sponsorship support ([9464edd](https://github.com/monygroupcorp/noema/commit/9464edd6638f2a6d141316519637e6c12b879d15))
* momentum pan with ring-buffer velocity and tap-to-kill ([b5686c6](https://github.com/monygroupcorp/noema/commit/b5686c6f464c7b5920ddfe932e01e3b1f82ce1a3))
* multi-line expression support — each line pipes result as input to the next ([1d8c6d0](https://github.com/monygroupcorp/noema/commit/1d8c6d077d1d9b6d0ca88c62b54420f597bea976))
* only required input anchors visible in Z1/Z2, optional via node mode only ([c927658](https://github.com/monygroupcorp/noema/commit/c9276584e48ea3eb760e74108a8738140562509f))
* pass live tweaks to physics step and force functions ([acf2f21](https://github.com/monygroupcorp/noema/commit/acf2f21f0dcc38b8dbdc4432f231eb1c97008028))
* periodic memory reporter to Telegram feedback chat ([e8efda1](https://github.com/monygroupcorp/noema/commit/e8efda14b599a05474da73e67f56b8bbb8c0461f))
* referral code registration, cookie-based purchase attribution, and EXP gate ([6581163](https://github.com/monygroupcorp/noema/commit/6581163045b9917fb6ca21d109a5efd3495d187e))
* register groupsettings command and groupMenuManager in Discord bot ([41bb1c6](https://github.com/monygroupcorp/noema/commit/41bb1c6e0f45c2579a5b64f7abfd611998891241))
* replace CONNECTION_MODE state with parallel connection overlay on FSM ([018d9f9](https://github.com/monygroupcorp/noema/commit/018d9f90b2034e6acace2dc2b0a67d457bb85f12))
* **sandbox:** new boot flow — EIP-6963 detection, account-exists probe, AuthWidget ([10d6377](https://github.com/monygroupcorp/noema/commit/10d63771262a0bdeed8ddd017ace1180e867705e))
* **spells:** migrate spell execution page to microact SPA ([8f70426](https://github.com/monygroupcorp/noema/commit/8f7042656e1937db2ff892c7f307d01aa80529c8))
* startup announcement and memory monitor with 768MB cap ([98877a4](https://github.com/monygroupcorp/noema/commit/98877a4296e8a51f8dfdae73848d3d3051b1abe7))
* swipe-to-zoom zone, zoomIn FSM method, tweaker drawer UI + CSS, fix momentum scaling ([aacf533](https://github.com/monygroupcorp/noema/commit/aacf533fabae37eab82d2a61a1bcc28d49d81063))
* text result as clickable block with overlay, spell shows last result image ([2c16137](https://github.com/monygroupcorp/noema/commit/2c161373714e2ae389d5b8fe772e894e9a358b3d))
* **training:** add embellishment pre-flight dialog for captions and control images ([ead88a8](https://github.com/monygroupcorp/noema/commit/ead88a853add7019158155cb4d1e1d015d6fb2a8))
* typed SVG anchor icons, required/optional param split with toggle in node mode ([3498fcb](https://github.com/monygroupcorp/noema/commit/3498fcbe5afac8832d5b1dac042714015bb7d2f3))
* **ui:** add BatchPanel bottom-sheet component ([d237404](https://github.com/monygroupcorp/noema/commit/d237404b5c7624607994b91aef8663a211c87d13))
* **ui:** scale all font sizes 20% larger across sandbox and site ([d139db0](https://github.com/monygroupcorp/noema/commit/d139db0556cd8225c91e13e075c940bf6df2a9aa))
* **ui:** trigger BatchPanel from multi-image upload drop ([3e933db](https://github.com/monygroupcorp/noema/commit/3e933db9067ad87ee07bd73345aa8004d96cea34))
* **ux:** close any modal/overlay on Escape key ([fca8cae](https://github.com/monygroupcorp/noema/commit/fca8caed3aba39d6ed642f0ffc32a7a9ebf3b886))
* wire expression node client-side execution with array-to-batch support ([72e505a](https://github.com/monygroupcorp/noema/commit/72e505a592ad69dd10190233d25ee8d77c18a627))
* workflow auto-refresh every 6h + release.sh helper ([555751b](https://github.com/monygroupcorp/noema/commit/555751bcf51631729959e6b87c94a2c871110069))


### Bug Fixes

* add expr-eval to frontend package.json for Docker build ([0289c74](https://github.com/monygroupcorp/noema/commit/0289c748a84f8c2b2074575be747db929c9a72bc))
* add openssh-client to Docker image for VastAI SSH transport ([3fca152](https://github.com/monygroupcorp/noema/commit/3fca15235d6142ad7b7add9b9c5567d3c70c5515))
* admin middleware ethereumServices ref, remove custody reads, ALCHEMY_API_KEY migration ([014c4d4](https://github.com/monygroupcorp/noema/commit/014c4d43d07be457d02acfed42f4f49568274d69))
* **auth:** AuthWidget stable render + centered modal + AccountDropdown re-fetch on auth:success ([bade237](https://github.com/monygroupcorp/noema/commit/bade237bfff6864ed542bb49a2cc430b7ffed0f8))
* **auth:** cookie domain, wallet picker, logout redirect, wallet-only UI ([7ecc33e](https://github.com/monygroupcorp/noema/commit/7ecc33ecdaba2eb0e47849579c43cbcc8c459b77))
* **auth:** SPA shell is public, remove HTML redirect to /landing ([9667008](https://github.com/monygroupcorp/noema/commit/96670084c82beda34f8ff40496c9ab06757a91ef))
* auto-rebase before push in release.sh to avoid rejected pushes ([4dd7a86](https://github.com/monygroupcorp/noema/commit/4dd7a86e8fd8586ffa27c835fd381776398dd358))
* **batch:** fix upload URL passthrough, reduce poll frequency, handle race conditions ([996378d](https://github.com/monygroupcorp/noema/commit/996378dcb2e6d282d77fd0ea16713f7110edcfdd))
* **batch:** use exports bucket for batch zip storage ([042cda4](https://github.com/monygroupcorp/noema/commit/042cda4390c4d0515e2685a2a3a237b8da2bae5d))
* caddy reload crash on bind-mounted Caddyfile ([3e9607d](https://github.com/monygroupcorp/noema/commit/3e9607d4182b0ca492022b686992fe746b5c4f8c))
* canvas2 expression node system — batch, persistence, overlay nav ([dfeceb9](https://github.com/monygroupcorp/noema/commit/dfeceb9988baf8bdd1c8dfd9444020ef7bb28516))
* captions from embellishments not reaching training ([40b3847](https://github.com/monygroupcorp/noema/commit/40b3847d736c7935ac2725980830ed27d93420bb))
* chain docker build into release-please workflow ([cc0ab24](https://github.com/monygroupcorp/noema/commit/cc0ab24965b51bfccc2b88de8e54b68358f1ad81))
* clear pending updates on startup and filter pre-startup messages only ([7dcf53f](https://github.com/monygroupcorp/noema/commit/7dcf53f9b08eb69764d9a24b1861d5a5ff8af434))
* correct relative path in logsApi after moving out of logs/ subdir ([2d322fc](https://github.com/monygroupcorp/noema/commit/2d322fc00067fcaf466fd19b308bcd7256788c18))
* create logs directory in Docker image for winston ([3350fec](https://github.com/monygroupcorp/noema/commit/3350fec9d952900a6b58713b3b649bdcd912c732))
* **dalle:** upload generations to exports bucket instead of uploads ([fcc30b2](https://github.com/monygroupcorp/noema/commit/fcc30b22ac8980891d1c128a9dae3bf9b264e660))
* dataset edit form now saves uploaded images and styles file input ([cfd6656](https://github.com/monygroupcorp/noema/commit/cfd66569915433397be7c9949a9e131247429cf1))
* **design:** proper isometric grid — JS-computed background-size/position tracks viewport, iso period scales with zoom ([50f98b9](https://github.com/monygroupcorp/noema/commit/50f98b9ff04449ec78c8e60d38fcf79134e109c3))
* **dev:** point Vite publicDir at root public/ so /docs/* is served in dev ([f4f06d5](https://github.com/monygroupcorp/noema/commit/f4f06d54efeec1fa534313b3ce5d6da390aee7f6))
* direct window.ethereum fallback for ethOS injected wallet ([a25f98a](https://github.com/monygroupcorp/noema/commit/a25f98ac8f3b2b038b1223bdec0fda3287a4a5f4))
* **docs:** load /index.css on mount so NOEMA CSS variables are defined ([314fb6a](https://github.com/monygroupcorp/noema/commit/314fb6ad57665d71ee150cabcbad684f8aec73db))
* downgrade vitest to 3.2.4 for vite 5 compatibility ([28bb8ed](https://github.com/monygroupcorp/noema/commit/28bb8eda54e760660d85bab87e67add29c8a55ab))
* eliminate momentum overroll by removing setState from tick loop ([0f22b83](https://github.com/monygroupcorp/noema/commit/0f22b8384ebb265657d187052b31016e0676cbcf))
* expression node — execute button, always-visible anchors, delete-reconnect ([e246398](https://github.com/monygroupcorp/noema/commit/e24639873cf1461ebb6dcc6806ac8c25891bf80c))
* expression node serialization for workspace save/load, anchors Z1 only ([768eee5](https://github.com/monygroupcorp/noema/commit/768eee59ac562df0695a60899ce713be324b1e16))
* extend SSH auth timeout to 5min and increase offer retries to 5 ([931f5cf](https://github.com/monygroupcorp/noema/commit/931f5cfeadb02e5c4b3cdb976dc3d2c8a469fbcc))
* fast-fail SSH auth on repeated Permission denied (publickey) ([341e510](https://github.com/monygroupcorp/noema/commit/341e5100cc93fbdcb2de8dfbe98594e5fab94762))
* fetch full git history in CI so commit info resolves correctly ([85ba0d0](https://github.com/monygroupcorp/noema/commit/85ba0d0553bc40f034c0c6d95d2237870fa5530b))
* fetch full tool schemas from /registry, tap-to-cancel connection on touch ([c798685](https://github.com/monygroupcorp/noema/commit/c7986858e1572b4afbf440ca8b4a83a25daecdc8))
* filter out multi-GPU instances from VastAI offer search ([7386c50](https://github.com/monygroupcorp/noema/commit/7386c504e7b5609117256e7be5e9c63dd868b08f))
* finalize referral system migration to CreditVault native model ([1e5e228](https://github.com/monygroupcorp/noema/commit/1e5e228aff7beae8a1a08c16ff63b119da4eba7e))
* fortify Telegram polling and setupCommands initialization ([1b779ab](https://github.com/monygroupcorp/noema/commit/1b779abee7fcc66d2aa6b7d6e3f082bff28e0b0b))
* GPU preflight check fails when Accelerator() prints to stdout ([e5fae5b](https://github.com/monygroupcorp/noema/commit/e5fae5bff04bc4c7e480c6a12847c2ca1cf3ed88))
* hold _momentumPanX until next pan so async setState snap cannot occur ([fac262d](https://github.com/monygroupcorp/noema/commit/fac262de2057784c5d89871bafc7857348aaeafc))
* image overlay uses header bar for close button, reliable on mobile ([bb85aff](https://github.com/monygroupcorp/noema/commit/bb85affc89642ec15ac57e70f788ca288e4d999c))
* import getCreditVaultAddress at module scope for SpellPaymentService ([2ea0718](https://github.com/monygroupcorp/noema/commit/2ea0718a7dd2d346e2d073fdc5cd06b51bae9db8))
* intercept tap on result zones to open overlay instead of navigating node ([611cc98](https://github.com/monygroupcorp/noema/commit/611cc98891f960dd44c5659e113890392c504c80))
* **landing:** remove Nav chrome, align tagline to condensed uppercase to match header ([70d71fe](https://github.com/monygroupcorp/noema/commit/70d71fe6fdb7d29875c71a74270dfa447ef01ac2))
* log errors from startup announcement and memory monitor sends ([f6ae96b](https://github.com/monygroupcorp/noema/commit/f6ae96b775c04c937745dcc6b91a1766da416389))
* memory drop alert only fires after a warning or critical, not on normal GC ([288403f](https://github.com/monygroupcorp/noema/commit/288403f9541e61df1f17304387cb8b47d56ee140))
* **mobile:** docs sidebar drawer + landing capabilities stack on narrow screens ([cdc7dcc](https://github.com/monygroupcorp/noema/commit/cdc7dcc98a3a24579fb61128d799241a1975d90e))
* more robust telegram client; group points fixed ([366d91b](https://github.com/monygroupcorp/noema/commit/366d91ba87537e0e501112755420ba3f80c40b33))
* move logsApi out of gitignored logs/ directory ([bc1c516](https://github.com/monygroupcorp/noema/commit/bc1c5162e561289dd14397ffbe728a4b75e94a03))
* move workflow auto-refresh into WorkflowCacheManager, revert app/discord changes ([996e4b8](https://github.com/monygroupcorp/noema/commit/996e4b81e42891d75381dfe066642c6a05b7fbc9))
* move workflow refresh interval to after full startup ([e30b262](https://github.com/monygroupcorp/noema/commit/e30b262948d24c0a618b83c1467cdfd9768d91ab))
* **nav:** use getAppUrl() instead of hardcoded app URL ([90b532f](https://github.com/monygroupcorp/noema/commit/90b532f198db8da0f7a6a132f04595247ccf4ec2))
* partial recovery falsely marked failed; add GPU/cost to training card ([c038281](https://github.com/monygroupcorp/noema/commit/c03828108642a4fa7d8d304f746d80baa9f68d50))
* **radial:** center on click point, fix dismiss guard for new class names ([de2bf83](https://github.com/monygroupcorp/noema/commit/de2bf83ae1e5eaad528c3e54d11d58b9fd056313))
* **radial:** tools view → scrollable panel showing all tools, radial only for root/categories ([713644e](https://github.com/monygroupcorp/noema/commit/713644e7bb0c4b61816dc8feccb5efd927895954))
* registry-based deploy pipeline ([14bd484](https://github.com/monygroupcorp/noema/commit/14bd484ad4c7f816d4ddcc31cb3d42977a8593dd))
* release.sh polls for release-please PR instead of fixed delay ([cdebe4c](https://github.com/monygroupcorp/noema/commit/cdebe4c33ae168814cbd77fe3a22bd5455993bce))
* revert deleteWebhook change, restore original polling startup ([e297345](https://github.com/monygroupcorp/noema/commit/e297345d9be8458a95f189a5890532d7111e8770))
* revert elapsed cap, add generation counter to kill stale momentum ticks ([3b9aa14](https://github.com/monygroupcorp/noema/commit/3b9aa14a6f9f09a6daf4d41c48623c9af929b0f6))
* **sandbox:** use spell: prefix for spell toolIds, normalize legacy spell- prefix ([dd79bc3](https://github.com/monygroupcorp/noema/commit/dd79bc38bdedb6befbe69113c2de03f070f18b03))
* scope sample image search to samples dir and sample at final step ([73ae391](https://github.com/monygroupcorp/noema/commit/73ae39140f1eac4eb86044458ef7c48a101cdd72))
* search all GPU types upfront and fall through on SSH failure ([2691665](https://github.com/monygroupcorp/noema/commit/2691665d8c8d5c866643137c9fcb11713bdf2fd4))
* seed demo nodes directly on mount instead of loading API tools ([eaa993e](https://github.com/monygroupcorp/noema/commit/eaa993e79f95c296ba0ca46656a2e2f806f3e753))
* settings apiFetchLimit ReferenceError and 402 insufficient funds message ([e3e62c4](https://github.com/monygroupcorp/noema/commit/e3e62c4fabc07d01f837c286622351463edf18d0))
* **sidebar:** restore sandbox-sidebar compat class, move sb-handle outside overflow:hidden aside ([f6a4778](https://github.com/monygroupcorp/noema/commit/f6a4778ee80540a5da5aa96d020b27cf11ddcd32))
* skip exhausted VastAI offers across job retries ([ffd6937](https://github.com/monygroupcorp/noema/commit/ffd69379d6b3ee2c34388364628f626699f6bf26))
* sort VastAI offers by reliability first, then price ([beb1ea2](https://github.com/monygroupcorp/noema/commit/beb1ea25b5bca7cb57f43fc909ca8b577b8ebabf))
* spell last step is image, fix seed step order ([5294e5c](https://github.com/monygroupcorp/noema/commit/5294e5c726e07a8965d9fa266940b56715ea0aeb))
* **spells:** map usageCount to uses in marketplace API response ([777c1f0](https://github.com/monygroupcorp/noema/commit/777c1f09b19708232f120ac26fb4025dc693d259))
* startup message shows correct commit and stationthisbot name ([63a725b](https://github.com/monygroupcorp/noema/commit/63a725bca2bb9168fffa49a02c4b03c2f4731f6a))
* stop polling on 429 and skip polling when WS is connected ([ccad421](https://github.com/monygroupcorp/noema/commit/ccad421e5ade825679ea3bd86738e3d2ed03c5c5))
* stop Telegram polling on graceful shutdown to prevent blue-green 409 conflict ([99d8cd1](https://github.com/monygroupcorp/noema/commit/99d8cd1013cd451db6808ce2706057d1f5830715))
* telegram tools detail view and delivery menu info button ([adacf3d](https://github.com/monygroupcorp/noema/commit/adacf3d908d63a05b12c4e39f9f14b957e818a70))
* **training:** read caption sets from ds.embellishments instead of legacy /captions endpoint ([ce0ca75](https://github.com/monygroupcorp/noema/commit/ce0ca750d0680ce42d3f8718026076dcfcf232cf))
* treat staging subdomain as app subdomain, skip landing page redirect ([e070355](https://github.com/monygroupcorp/noema/commit/e070355ba1ecaeada2ef3f5fd83c27d1510f9041))
* tweaker tab tappable, no overroll snap on momentum stop ([b62d4b3](https://github.com/monygroupcorp/noema/commit/b62d4b3b9a063cf6997b6f72c5bebe1c64f2a20f))
* type anchor-connectable inputs/outputs across demo tools (text, video) ([023c385](https://github.com/monygroupcorp/noema/commit/023c3854e23e1808ae6c0c4cf499f3506eec4f35))
* type dalle output as image, prompt input as text for anchor type system ([a197aa4](https://github.com/monygroupcorp/noema/commit/a197aa48dd5bef7026f63d7f94469e3edada15c3))
* **ui:** restore tool window chrome CSS, fix account dropdown mobile overflow ([61909f0](https://github.com/monygroupcorp/noema/commit/61909f05290366dc23f2459a76491d246d39c766))
* unify magic amount generation and cap at 7 decimal places ([bb802d1](https://github.com/monygroupcorp/noema/commit/bb802d1ceffd89ac1781c8415477c66aa2c52f60))
* update VaultModal for on-chain referral registration, fix check-name 404, filter legacy vaults ([f1bd715](https://github.com/monygroupcorp/noema/commit/f1bd715933842291f33c6f55095bd4234e68ddd0))
* **upload:** add multiple attribute to file input for batch selection ([0fa2206](https://github.com/monygroupcorp/noema/commit/0fa2206f49dc646a57935b33bea539861879513d))
* **upload:** proxy upload through server to bypass R2 CORS; redesign upload node UX ([8725f33](https://github.com/monygroupcorp/noema/commit/8725f332f4715b8264c40288a740d1323cc2515c))
* **upload:** use imperative file input for reliable multiple selection ([a54504c](https://github.com/monygroupcorp/noema/commit/a54504c4555cf5d9ab01d563751b1f980d637fd7))
* **upload:** use visible file input like TrainingStudio for reliable multi-select ([be5d71f](https://github.com/monygroupcorp/noema/commit/be5d71f708aaec06d9bb35290120a86296109b72))
* use vitest 2.1.9 — no nested vite 7, clean @types/node resolution ([836b7dd](https://github.com/monygroupcorp/noema/commit/836b7dd5169fb3a762289641b43b0283099d511d))
* wallet connect for ethOS smart contract wallets ([328d233](https://github.com/monygroupcorp/noema/commit/328d2334ed31e4db8d965b909cc10a1fbb418310))


### Performance Improvements

* add SSH ControlMaster multiplexing to SshTransport ([58c7b77](https://github.com/monygroupcorp/noema/commit/58c7b770f87200ea476c9e59696eec04036109e4))

## [4.6.18](https://github.com/monygroupcorp/noema/compare/v4.6.17...v4.6.18) (2026-03-29)


### Bug Fixes

* direct window.ethereum fallback for ethOS injected wallet ([a25f98a](https://github.com/monygroupcorp/noema/commit/a25f98ac8f3b2b038b1223bdec0fda3287a4a5f4))

## [4.6.17](https://github.com/monygroupcorp/noema/compare/v4.6.16...v4.6.17) (2026-03-29)


### Bug Fixes

* wallet connect for ethOS smart contract wallets ([328d233](https://github.com/monygroupcorp/noema/commit/328d2334ed31e4db8d965b909cc10a1fbb418310))

## [4.6.16](https://github.com/monygroupcorp/noema/compare/v4.6.15...v4.6.16) (2026-03-29)


### Bug Fixes

* more robust telegram client; group points fixed ([366d91b](https://github.com/monygroupcorp/noema/commit/366d91ba87537e0e501112755420ba3f80c40b33))

## [4.6.15](https://github.com/monygroupcorp/noema/compare/v4.6.14...v4.6.15) (2026-03-28)


### Bug Fixes

* canvas2 expression node system — batch, persistence, overlay nav ([dfeceb9](https://github.com/monygroupcorp/noema/commit/dfeceb9988baf8bdd1c8dfd9444020ef7bb28516))

## [4.6.14](https://github.com/monygroupcorp/noema/compare/v4.6.13...v4.6.14) (2026-03-27)


### Bug Fixes

* partial recovery falsely marked failed; add GPU/cost to training card ([c038281](https://github.com/monygroupcorp/noema/commit/c03828108642a4fa7d8d304f746d80baa9f68d50))

## [4.6.13](https://github.com/monygroupcorp/noema/compare/v4.6.12...v4.6.13) (2026-03-27)


### Bug Fixes

* filter out multi-GPU instances from VastAI offer search ([7386c50](https://github.com/monygroupcorp/noema/commit/7386c504e7b5609117256e7be5e9c63dd868b08f))

## [4.6.12](https://github.com/monygroupcorp/noema/compare/v4.6.11...v4.6.12) (2026-03-27)


### Bug Fixes

* memory drop alert only fires after a warning or critical, not on normal GC ([288403f](https://github.com/monygroupcorp/noema/commit/288403f9541e61df1f17304387cb8b47d56ee140))

## [4.6.11](https://github.com/monygroupcorp/noema/compare/v4.6.10...v4.6.11) (2026-03-27)


### Bug Fixes

* stop Telegram polling on graceful shutdown to prevent blue-green 409 conflict ([99d8cd1](https://github.com/monygroupcorp/noema/commit/99d8cd1013cd451db6808ce2706057d1f5830715))

## [4.6.10](https://github.com/monygroupcorp/noema/compare/v4.6.9...v4.6.10) (2026-03-26)


### Bug Fixes

* captions from embellishments not reaching training ([40b3847](https://github.com/monygroupcorp/noema/commit/40b3847d736c7935ac2725980830ed27d93420bb))

## [4.6.9](https://github.com/monygroupcorp/noema/compare/v4.6.8...v4.6.9) (2026-03-26)


### Bug Fixes

* fast-fail SSH auth on repeated Permission denied (publickey) ([341e510](https://github.com/monygroupcorp/noema/commit/341e5100cc93fbdcb2de8dfbe98594e5fab94762))

## [4.6.8](https://github.com/monygroupcorp/noema/compare/v4.6.7...v4.6.8) (2026-03-26)


### Bug Fixes

* add openssh-client to Docker image for VastAI SSH transport ([3fca152](https://github.com/monygroupcorp/noema/commit/3fca15235d6142ad7b7add9b9c5567d3c70c5515))

## [4.6.7](https://github.com/monygroupcorp/noema/compare/v4.6.6...v4.6.7) (2026-03-26)


### Bug Fixes

* search all GPU types upfront and fall through on SSH failure ([2691665](https://github.com/monygroupcorp/noema/commit/2691665d8c8d5c866643137c9fcb11713bdf2fd4))

## [4.6.6](https://github.com/monygroupcorp/noema/compare/v4.6.5...v4.6.6) (2026-03-26)


### Bug Fixes

* log errors from startup announcement and memory monitor sends ([f6ae96b](https://github.com/monygroupcorp/noema/commit/f6ae96b775c04c937745dcc6b91a1766da416389))

## [4.6.5](https://github.com/monygroupcorp/noema/compare/v4.6.4...v4.6.5) (2026-03-26)


### Bug Fixes

* skip exhausted VastAI offers across job retries ([ffd6937](https://github.com/monygroupcorp/noema/commit/ffd69379d6b3ee2c34388364628f626699f6bf26))

## [4.6.4](https://github.com/monygroupcorp/noema/compare/v4.6.3...v4.6.4) (2026-03-26)


### Bug Fixes

* extend SSH auth timeout to 5min and increase offer retries to 5 ([931f5cf](https://github.com/monygroupcorp/noema/commit/931f5cfeadb02e5c4b3cdb976dc3d2c8a469fbcc))

## [4.6.3](https://github.com/monygroupcorp/noema/compare/v4.6.2...v4.6.3) (2026-03-26)


### Bug Fixes

* sort VastAI offers by reliability first, then price ([beb1ea2](https://github.com/monygroupcorp/noema/commit/beb1ea25b5bca7cb57f43fc909ca8b577b8ebabf))

## [4.6.2](https://github.com/monygroupcorp/noema/compare/v4.6.1...v4.6.2) (2026-03-26)


### Bug Fixes

* fetch full git history in CI so commit info resolves correctly ([85ba0d0](https://github.com/monygroupcorp/noema/commit/85ba0d0553bc40f034c0c6d95d2237870fa5530b))


### Performance Improvements

* add SSH ControlMaster multiplexing to SshTransport ([58c7b77](https://github.com/monygroupcorp/noema/commit/58c7b770f87200ea476c9e59696eec04036109e4))

## [4.6.1](https://github.com/monygroupcorp/noema/compare/v4.6.0...v4.6.1) (2026-03-26)


### Bug Fixes

* startup message shows correct commit and stationthisbot name ([63a725b](https://github.com/monygroupcorp/noema/commit/63a725bca2bb9168fffa49a02c4b03c2f4731f6a))

## [4.6.0](https://github.com/monygroupcorp/noema/compare/v4.5.0...v4.6.0) (2026-03-26)


### Features

* startup announcement and memory monitor with 768MB cap ([98877a4](https://github.com/monygroupcorp/noema/commit/98877a4296e8a51f8dfdae73848d3d3051b1abe7))

## [4.5.0](https://github.com/monygroupcorp/noema/compare/v4.4.0...v4.5.0) (2026-03-26)


### Features

* periodic memory reporter to Telegram feedback chat ([e8efda1](https://github.com/monygroupcorp/noema/commit/e8efda14b599a05474da73e67f56b8bbb8c0461f))

## [4.4.0](https://github.com/monygroupcorp/noema/compare/v4.3.10...v4.4.0) (2026-03-25)


### Features

* referral code registration, cookie-based purchase attribution, and EXP gate ([6581163](https://github.com/monygroupcorp/noema/commit/6581163045b9917fb6ca21d109a5efd3495d187e))


### Bug Fixes

* GPU preflight check fails when Accelerator() prints to stdout ([e5fae5b](https://github.com/monygroupcorp/noema/commit/e5fae5bff04bc4c7e480c6a12847c2ca1cf3ed88))

## [4.3.10](https://github.com/monygroupcorp/noema/compare/v4.3.9...v4.3.10) (2026-03-25)


### Bug Fixes

* settings apiFetchLimit ReferenceError and 402 insufficient funds message ([e3e62c4](https://github.com/monygroupcorp/noema/commit/e3e62c4fabc07d01f837c286622351463edf18d0))

## [4.3.9](https://github.com/monygroupcorp/noema/compare/v4.3.8...v4.3.9) (2026-03-25)


### Bug Fixes

* fortify Telegram polling and setupCommands initialization ([1b779ab](https://github.com/monygroupcorp/noema/commit/1b779abee7fcc66d2aa6b7d6e3f082bff28e0b0b))

## [4.3.8](https://github.com/monygroupcorp/noema/compare/v4.3.7...v4.3.8) (2026-03-25)


### Bug Fixes

* dataset edit form now saves uploaded images and styles file input ([cfd6656](https://github.com/monygroupcorp/noema/commit/cfd66569915433397be7c9949a9e131247429cf1))

## [4.3.7](https://github.com/monygroupcorp/noema/compare/v4.3.6...v4.3.7) (2026-03-25)


### Bug Fixes

* scope sample image search to samples dir and sample at final step ([73ae391](https://github.com/monygroupcorp/noema/commit/73ae39140f1eac4eb86044458ef7c48a101cdd72))

## [4.3.6](https://github.com/monygroupcorp/noema/compare/v4.3.5...v4.3.6) (2026-03-25)


### Bug Fixes

* telegram tools detail view and delivery menu info button ([adacf3d](https://github.com/monygroupcorp/noema/commit/adacf3d908d63a05b12c4e39f9f14b957e818a70))

## [4.3.5](https://github.com/monygroupcorp/noema/compare/v4.3.4...v4.3.5) (2026-03-24)


### Bug Fixes

* auto-rebase before push in release.sh to avoid rejected pushes ([4dd7a86](https://github.com/monygroupcorp/noema/commit/4dd7a86e8fd8586ffa27c835fd381776398dd358))

## [4.3.4](https://github.com/monygroupcorp/noema/compare/v4.3.3...v4.3.4) (2026-03-24)


### Bug Fixes

* revert deleteWebhook change, restore original polling startup ([e297345](https://github.com/monygroupcorp/noema/commit/e297345d9be8458a95f189a5890532d7111e8770))

## [4.3.3](https://github.com/monygroupcorp/noema/compare/v4.3.2...v4.3.3) (2026-03-24)


### Bug Fixes

* clear pending updates on startup and filter pre-startup messages only ([7dcf53f](https://github.com/monygroupcorp/noema/commit/7dcf53f9b08eb69764d9a24b1861d5a5ff8af434))

## [4.3.2](https://github.com/monygroupcorp/noema/compare/v4.3.1...v4.3.2) (2026-03-24)


### Bug Fixes

* move workflow auto-refresh into WorkflowCacheManager, revert app/discord changes ([996e4b8](https://github.com/monygroupcorp/noema/commit/996e4b81e42891d75381dfe066642c6a05b7fbc9))

## [4.3.1](https://github.com/monygroupcorp/noema/compare/v4.3.0...v4.3.1) (2026-03-24)


### Bug Fixes

* release.sh polls for release-please PR instead of fixed delay ([cdebe4c](https://github.com/monygroupcorp/noema/commit/cdebe4c33ae168814cbd77fe3a22bd5455993bce))

## [4.3.0](https://github.com/monygroupcorp/noema/compare/v4.2.3...v4.3.0) (2026-03-24)


### Features

* workflow auto-refresh every 6h + release.sh helper ([555751b](https://github.com/monygroupcorp/noema/commit/555751bcf51631729959e6b87c94a2c871110069))

## [4.2.3](https://github.com/monygroupcorp/noema/compare/v4.2.2...v4.2.3) (2026-03-20)


### Bug Fixes

* finalize referral system migration to CreditVault native model ([1e5e228](https://github.com/monygroupcorp/noema/commit/1e5e228aff7beae8a1a08c16ff63b119da4eba7e))

## [4.2.2](https://github.com/monygroupcorp/noema/compare/v4.2.1...v4.2.2) (2026-03-19)


### Bug Fixes

* treat staging subdomain as app subdomain, skip landing page redirect ([e070355](https://github.com/monygroupcorp/noema/commit/e070355ba1ecaeada2ef3f5fd83c27d1510f9041))
* unify magic amount generation and cap at 7 decimal places ([bb802d1](https://github.com/monygroupcorp/noema/commit/bb802d1ceffd89ac1781c8415477c66aa2c52f60))

## [4.2.1](https://github.com/monygroupcorp/noema/compare/v4.2.0...v4.2.1) (2026-03-17)


### Bug Fixes

* update VaultModal for on-chain referral registration, fix check-name 404, filter legacy vaults ([f1bd715](https://github.com/monygroupcorp/noema/commit/f1bd715933842291f33c6f55095bd4234e68ddd0))

## [4.2.0](https://github.com/monygroupcorp/noema/compare/v4.1.0...v4.2.0) (2026-03-17)


### Features

* add findReferralVaultByKey, getReferralDashboardStats, update stats to use referral_key ([c8ec085](https://github.com/monygroupcorp/noema/commit/c8ec085717835e34918f7c4c911a1d04be52d9d5))

## [4.1.0](https://github.com/monygroupcorp/noema/compare/v4.0.3...v4.1.0) (2026-03-16)


### Features

* blue-green deploy — zero downtime container swap ([4b99abf](https://github.com/monygroupcorp/noema/commit/4b99abfed1869cebae3cfc84258463fb087d9d93))

## [4.0.3](https://github.com/monygroupcorp/noema/compare/v4.0.2...v4.0.3) (2026-03-16)


### Bug Fixes

* import getCreditVaultAddress at module scope for SpellPaymentService ([2ea0718](https://github.com/monygroupcorp/noema/commit/2ea0718a7dd2d346e2d073fdc5cd06b51bae9db8))

## [4.0.2](https://github.com/monygroupcorp/noema/compare/v4.0.1...v4.0.2) (2026-03-16)


### Bug Fixes

* caddy reload crash on bind-mounted Caddyfile ([3e9607d](https://github.com/monygroupcorp/noema/commit/3e9607d4182b0ca492022b686992fe746b5c4f8c))
* chain docker build into release-please workflow ([cc0ab24](https://github.com/monygroupcorp/noema/commit/cc0ab24965b51bfccc2b88de8e54b68358f1ad81))
* create logs directory in Docker image for winston ([3350fec](https://github.com/monygroupcorp/noema/commit/3350fec9d952900a6b58713b3b649bdcd912c732))

## [4.0.1](https://github.com/monygroupcorp/noema/compare/v4.0.0...v4.0.1) (2026-03-15)


### Bug Fixes

* registry-based deploy pipeline ([14bd484](https://github.com/monygroupcorp/noema/commit/14bd484ad4c7f816d4ddcc31cb3d42977a8593dd))
