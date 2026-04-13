# Changelog

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
