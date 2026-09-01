# Changelog

## [5.23.0](https://github.com/monygroupcorp/noema/compare/v5.22.0...v5.23.0) (2026-09-01)


### Features

* **api:** create a dataset with no media and populate it afterwards ([41c7112](https://github.com/monygroupcorp/noema/commit/41c7112481a326666fcb9e590be676e8a41bce50))
* **api:** create a dataset with no media and populate it afterwards ([c23e3f9](https://github.com/monygroupcorp/noema/commit/c23e3f915b3b32103577ad681d140e5db7c84484))
* **api:** expose run cancellation on the v1 surface ([6699d48](https://github.com/monygroupcorp/noema/commit/6699d4885d17f85fb71bdaaa171e128437af808e))
* **api:** expose run cancellation on the v1 surface ([5f201a0](https://github.com/monygroupcorp/noema/commit/5f201a034f8c73e12c0deb8a32e0c57db29939f9))
* **collections:** cancel a collection's in-flight pieces with the collection ([c03a042](https://github.com/monygroupcorp/noema/commit/c03a0424222f99456b2738381d849ec99c0abc6a))
* **collections:** cancel a collection's in-flight pieces with the collection ([165ff00](https://github.com/monygroupcorp/noema/commit/165ff003c9e996350f81ba10747b0b7c11182055))
* **crystal:** MiniMax H3 video — t2v, fl2v and ref2v on one ComfyUI substrate ([706cc4a](https://github.com/monygroupcorp/noema/commit/706cc4aac833b35fe3e023fc33e3daad9d0c87eb))
* **crystal:** open the LoRA rail on the MiniMax H3 flows ([6d684f4](https://github.com/monygroupcorp/noema/commit/6d684f4d32f9d575385565a0fcd850a59ef8908d))
* **datasets:** resolve a run's dataset reference for the caller's team ([93b232d](https://github.com/monygroupcorp/noema/commit/93b232d3fba06020b89f6acee44537a13e2a614f))
* **datasets:** resolve a run's dataset reference for the caller's team (ADR-0014 q2) ([d0babad](https://github.com/monygroupcorp/noema/commit/d0babad6583e2f89292551d7bd6f3c2a95476ccb))
* **ledger:** calibrate the krea-turbo reservation from its own cost curve ([b05260e](https://github.com/monygroupcorp/noema/commit/b05260efd45273c752f4730e3205fd86e5565b2f))
* **ledger:** calibrate the krea-turbo reservation from its own cost curve ([0219d2a](https://github.com/monygroupcorp/noema/commit/0219d2a68c26c2921cc98b861b6cdba26221164a))
* **projects:** honour Provincia.sodalitasId — team read + contribution ([4484dd2](https://github.com/monygroupcorp/noema/commit/4484dd22403e1b5d6cdda88ceb9d2dd38c479ed1))
* **projects:** share a Provincia with a Sodalitas — team read + contribution ([3efa0e4](https://github.com/monygroupcorp/noema/commit/3efa0e48aed2b910e615f4c9b7312265148b68c2))
* **web:** let a user publish their own private model ([27c7ed7](https://github.com/monygroupcorp/noema/commit/27c7ed7709fbd0121c5ae10702d4ef9928ba95d9))
* **web:** let a user publish their own private model ([aa5bad9](https://github.com/monygroupcorp/noema/commit/aa5bad972a5ea6e8a831eba788af99b265cbff9f))


### Bug Fixes

* **api:** read a studio by id in every state its owner is shown ([e755c35](https://github.com/monygroupcorp/noema/commit/e755c352617a967d9e7fe217f449c90efebb7302))
* **api:** read a studio by id in every state its owner is shown ([5e63294](https://github.com/monygroupcorp/noema/commit/5e632944b644f90577fd06d29920cad74407d20b))
* **api:** type the parity test's host keys as HostKey ([8d66f40](https://github.com/monygroupcorp/noema/commit/8d66f40a89373867a1d12b3c694c823e7ec7cd76))
* **crystal:** correct the MiniMax H3 HuggingFace fallback sources ([bd3c984](https://github.com/monygroupcorp/noema/commit/bd3c9842bfe44c6b8691e65d5d00109affd6c033))
* **crystal:** count pieces held for review in their collection ([f4c9da3](https://github.com/monygroupcorp/noema/commit/f4c9da3facc4aef29412d9ad2d77530469203433))
* **crystal:** count pieces held for review in their collection ([acfaf85](https://github.com/monygroupcorp/noema/commit/acfaf851ad54697bca461e0f565913d3fea9fc5e))
* **crystal:** pin the MiniMax H3 substrate to ComfyUI v0.33.0 ([122a379](https://github.com/monygroupcorp/noema/commit/122a379ee2c8b8d844377840b302a6f96760685a))
* **datasets:** ingest generation media recorded as a private-output marker ([9c1fe3c](https://github.com/monygroupcorp/noema/commit/9c1fe3c39b5b2075ac8dc0e6d29694c695c01023))
* **datasets:** ingest generation media recorded as a private-output marker ([c5fb32c](https://github.com/monygroupcorp/noema/commit/c5fb32c9d2aa0778bed9b34187cd0ff953c4495b))
* **execution:** accrue session spend from the settled amount ([cdf5d8d](https://github.com/monygroupcorp/noema/commit/cdf5d8d9d83422e72e8974527b28366f19c5ea09))
* **execution:** accrue session spend from the settled amount ([5dea72a](https://github.com/monygroupcorp/noema/commit/5dea72ad9698a41389c810e2dd41afb74c9ebe6f))
* **scripts:** seed the walk's held pieces as pendingReview, not completed ([e9c878b](https://github.com/monygroupcorp/noema/commit/e9c878b23cc8774046b0c440bcfc10cbc3e812b3))

## [5.22.0](https://github.com/monygroupcorp/noema/compare/v5.21.0...v5.22.0) (2026-08-31)


### Features

* **datasets:** share a Dataset with a Sodalitas — team read + contribution ([6ab519c](https://github.com/monygroupcorp/noema/commit/6ab519cb4d0fedd2e0f5bcb24337b4709b01e457))
* **datasets:** share a Dataset with a Sodalitas — team read + contribution ([ba79005](https://github.com/monygroupcorp/noema/commit/ba790054f1870c31f446e124abb226095fa517f4))
* **scripts:** every candidate image is written to disk as it is fetched ([3bd0986](https://github.com/monygroupcorp/noema/commit/3bd0986b7f4d05446b67bf08e4a9a576b5b1c710))
* **scripts:** the landing walk's grid is runtime config, and a quote is a reserve ([1aff6e4](https://github.com/monygroupcorp/noema/commit/1aff6e496b1da787eb22c29dfa8e2669e04ede83))


### Bug Fixes

* **collectio:** seed reiectae in MongoCollectio so a fired collection dispatches ([04f7fe8](https://github.com/monygroupcorp/noema/commit/04f7fe8c83e73fd5bbe02ebef43591a662453884))
* **collectio:** seed reiectae in MongoCollectio so a fired collection dispatches ([de9ac9c](https://github.com/monygroupcorp/noema/commit/de9ac9ce3a6e2afd755e1e58a080cfa2980d9821))
* **scripts:** a dry pass reports SKIP and says DRY, instead of failing checks it never ran ([0856f59](https://github.com/monygroupcorp/noema/commit/0856f59d2738912783179c991e463190408da726))
* **scripts:** apply the noema-359 ruling — a failed dispatch is accounted, not lost ([81fba09](https://github.com/monygroupcorp/noema/commit/81fba0919e84f76b8772ea82f9c045d9fe5d21d5))
* **scripts:** landing walk — ruled grid, reserve-not-price costing, and honest receipts ([fe653a2](https://github.com/monygroupcorp/noema/commit/fe653a2b08ccb837b5ee0c844d42488804289641))
* **scripts:** the scene axis carries all sixteen ruled scenes, so 384 is reachable ([359a863](https://github.com/monygroupcorp/noema/commit/359a863ec1b6ccd33565b8c38835a586a1763ec9))
* **scripts:** the smoke fixture answers /v1/me, so the headroom gate is proven ([e63c781](https://github.com/monygroupcorp/noema/commit/e63c7810c72f82fcb72219d0a254e5bf62d5e8d0))
* **scripts:** the trigger word default is the ruled `noema`, not the draft `nmahaus` ([29ce65f](https://github.com/monygroupcorp/noema/commit/29ce65f522c876a1692e183dbe0abc3b6ea53f2a))

## [5.21.0](https://github.com/monygroupcorp/noema/compare/v5.20.0...v5.21.0) (2026-08-31)


### Features

* **concierge:** SEE rung 3 — dataset/activity/muse discovery tools ([99fa552](https://github.com/monygroupcorp/noema/commit/99fa552358a755b23d31518054f265a917852707))
* **concierge:** SEE rung 3 — dataset/activity/muse discovery tools ([419290d](https://github.com/monygroupcorp/noema/commit/419290d2b7b8900f7bec11cef0c46d497da18393))
* **scripts:** add landing-dataset-walk driver for the house-look dataset run ([ed96f20](https://github.com/monygroupcorp/noema/commit/ed96f204b240ca757bb0bba6e0ea948a1f0365f9))
* **scripts:** add landing-dataset-walk driver for the house-look dataset run ([313a836](https://github.com/monygroupcorp/noema/commit/313a836e8b87665208eb3050447f868f0b07df2f))


### Bug Fixes

* **allocutio:** dedupe in-turn tool calls and retry an empty closing call ([e2d37de](https://github.com/monygroupcorp/noema/commit/e2d37deb9c033535b24ca977499c6d32a4083ef6))
* **allocutio:** dedupe in-turn tool calls and retry an empty closing call ([627a481](https://github.com/monygroupcorp/noema/commit/627a481dead7313e63cd1c4ec065f66710328252))
* **execution:** release a run's reservation on every post-initiate dispatch failure ([2d30919](https://github.com/monygroupcorp/noema/commit/2d309196147f510d819808fdb97afab1358021e9))
* **execution:** release a run's reservation on every post-initiate dispatch failure ([28feee9](https://github.com/monygroupcorp/noema/commit/28feee9abe8384fe66686b968ad095b3fb138d55))

## [5.20.0](https://github.com/monygroupcorp/noema/compare/v5.19.1...v5.20.0) (2026-08-28)


### Features

* **concierge-gym:** add referee to replay and verdict a submitted deck entry ([eac24d7](https://github.com/monygroupcorp/noema/commit/eac24d73ed605b6b59697f4af964c526f76fbc23))
* concierge-walk — a scripted headless session over the anonymous bursa rail ([f13e6a8](https://github.com/monygroupcorp/noema/commit/f13e6a87e8464ada612e9ed1d0551e73d9cd79aa))
* **concierge:** NAVIGATE — reply carries a validated destination, the client renders the link ([8670b38](https://github.com/monygroupcorp/noema/commit/8670b386ffc31116b4a359393e935ee7eaa958b6))
* **concierge:** NAVIGATE — reply carries a validated destination, the client renders the link ([e79e461](https://github.com/monygroupcorp/noema/commit/e79e46176932313577431b24103bf2708a430346))
* **concierge:** register collection/studio/fundamenta discovery tools ([3074526](https://github.com/monygroupcorp/noema/commit/30745267de8c571118d4acb8ca495e02a1edbee4))
* **concierge:** register collection/studio/fundamenta discovery tools ([8a806d2](https://github.com/monygroupcorp/noema/commit/8a806d2c1855bc24e128b3e12bca997f728a1017))


### Bug Fixes

* **concierge:** answer from gathered context when the tool-iteration cap is reached ([8798b5a](https://github.com/monygroupcorp/noema/commit/8798b5a73b28d786ad422f8431069fa2801dcc8b))
* **concierge:** answer from gathered context when the tool-iteration cap is reached ([885e1ad](https://github.com/monygroupcorp/noema/commit/885e1adb81a601983bead097c978b3eaab4aeb61))
* **concierge:** derive the read-only tool set from one export ([710deec](https://github.com/monygroupcorp/noema/commit/710deec20624023bf2cb75e021a96d4c59a94ee7))
* **concierge:** make the proposal quote read as a price ([0cae931](https://github.com/monygroupcorp/noema/commit/0cae931492b00401ad0e459b41e19beb5dc33a5f))
* **concierge:** make the proposal quote read as a price ([7e0f72c](https://github.com/monygroupcorp/noema/commit/7e0f72c4979ba218ae5dbc297c9bd8fd34de1922))
* **crystal:** keep a collection dispatching across a process restart ([9a29a6a](https://github.com/monygroupcorp/noema/commit/9a29a6a9af3370204cca21d0b627a662b91aad96))
* **crystal:** keep a collection dispatching across a process restart ([4b04251](https://github.com/monygroupcorp/noema/commit/4b04251dbbb98d397d3203e6298bb8722fb33d08))
* **crystal:** legacy-settlement migration find rejected whole — $regex nested under $in ([75c0d4d](https://github.com/monygroupcorp/noema/commit/75c0d4d33cc0574ff665834e2314cb3bafe48a05))
* **crystal:** the legacy-settlement migration's candidate find was rejected whole by the server ([a7134d1](https://github.com/monygroupcorp/noema/commit/a7134d1b9e8221a2a33af1ee97afe59f366e3659))
* surface in-flight and pending-review state on the canonic run screen ([af8ab43](https://github.com/monygroupcorp/noema/commit/af8ab43a6b7c38d8626f3bc41be77e916601b881))

## [5.19.1](https://github.com/monygroupcorp/noema/compare/v5.19.0...v5.19.1) (2026-08-27)


### Bug Fixes

* **crystal:** price coin-listed deposit assets, and record deposits settled before the cutover ([3aca9ec](https://github.com/monygroupcorp/noema/commit/3aca9ec2723c50c6a5f07867ff6e2645b6a0f68d))
* **crystal:** price coin-listed deposit assets, and record deposits settled before the cutover ([7b9e8cd](https://github.com/monygroupcorp/noema/commit/7b9e8cd629dc3efee0e8e334e05da6063d194486))
* **crystal:** reconcile deposits on an interval, not only at boot ([31a5f09](https://github.com/monygroupcorp/noema/commit/31a5f09764b48a0fef2fd282d383daf1de9c1cdb))
* **crystal:** reconcile deposits on an interval, not only at boot ([97957a4](https://github.com/monygroupcorp/noema/commit/97957a4644573bfef1139dafa67ddb0aac0e512c))

## [5.19.0](https://github.com/monygroupcorp/noema/compare/v5.18.0...v5.19.0) (2026-08-27)


### Features

* **muse:** lock fragments, vary around a roll, and step back through the mining tree ([5df702b](https://github.com/monygroupcorp/noema/commit/5df702bb18cae1b91b99fcbab303639dfa34ff0f))
* **muse:** lock fragments, vary around a roll, and step back through the mining tree ([4ebd35f](https://github.com/monygroupcorp/noema/commit/4ebd35f9dfe4616fee9157d3e363b93aade65ced))
* private generation, phase 1 — an account-level private outputs toggle ([b680bb4](https://github.com/monygroupcorp/noema/commit/b680bb4e9ddd427eece0f0444cb1d709f6744e07))
* **web:** promote 13/15px type steps and retune radius token ([0de0a8e](https://github.com/monygroupcorp/noema/commit/0de0a8e90803729fbaf413ab91d0822f82cebbc7))
* **web:** promote 13/15px type steps and retune radius token ([b94b4bf](https://github.com/monygroupcorp/noema/commit/b94b4bfc41bec6ced8fb248dec66ad19e3e232fb))
* **web:** un-gate the TEE roadmap line on the dashboard ([b393877](https://github.com/monygroupcorp/noema/commit/b39387788da0839def410372ccd4cac60fe52fbd))
* **web:** un-gate the TEE roadmap line on the dashboard ([25a9e4c](https://github.com/monygroupcorp/noema/commit/25a9e4ce5d426e00734e26d38a1c2aba5f8c16bb))


### Bug Fixes

* **crystal:** decompose dispatches async and settles its own run ([0cdad93](https://github.com/monygroupcorp/noema/commit/0cdad9388a8228c5660497288479f88d041bd2c0))
* **crystal:** decompose modus declares async, conservation tests get their own file ([1ec2a3b](https://github.com/monygroupcorp/noema/commit/1ec2a3be5e96884b81c0f9deb31ace10c08a10d3))
* **crystal:** decompose modus declares async, conservation tests get their own file ([395e25b](https://github.com/monygroupcorp/noema/commit/395e25b93101214272f502cfa813e4b816bf457b))
* **deposits:** reconcile vault deposits from the chain's own logs ([ffc150e](https://github.com/monygroupcorp/noema/commit/ffc150e65537b96da43d605e5416adbbc68b4732))
* **deposits:** reconcile vault deposits from the chain's own logs ([af1c7be](https://github.com/monygroupcorp/noema/commit/af1c7be6c5dbe8430af6362fae582b87b8ddcc71))
* rename decompose activity door label to 'view cutting floor' ([2956d2c](https://github.com/monygroupcorp/noema/commit/2956d2cac835c4eb931c3b68848364547ae95cdd))
* rename decompose activity door label to 'view cutting floor' ([9816332](https://github.com/monygroupcorp/noema/commit/9816332d0a8ed1d7bce79d49c7c444282fc36e4b))
* **web:** privacy and cookie policies describe the shipped service ([3ede15b](https://github.com/monygroupcorp/noema/commit/3ede15bf4b48322b63300276a658c476da4f42df))
* **web:** privacy and cookie policies describe the shipped service ([cafdb41](https://github.com/monygroupcorp/noema/commit/cafdb41bcd59e84b5bda2308ca82e80bf05093fd))
* **web:** resolve ceremony.css section-rhythm token lint residual ([61f89b2](https://github.com/monygroupcorp/noema/commit/61f89b2370f98a94158e2190aa5038d75e2e25e5))
* **web:** resolve ceremony.css section-rhythm token lint residual ([6b93202](https://github.com/monygroupcorp/noema/commit/6b932020f83814069d1fb6c7119378f4acbd61f1))
* **web:** widen token-lint importFrom to include app.css aliases ([00500a9](https://github.com/monygroupcorp/noema/commit/00500a9c48753f1b1698f61c97179a9f746f3d52))
* **web:** widen token-lint importFrom to include app.css aliases ([3ead7b5](https://github.com/monygroupcorp/noema/commit/3ead7b56c0103202c6e9646b5d483ff1db35e355))

## [5.18.0](https://github.com/monygroupcorp/noema/compare/v5.17.0...v5.18.0) (2026-08-26)


### Features

* **purses:** redeem a purse token into the holder's balance ([0584592](https://github.com/monygroupcorp/noema/commit/0584592a56029b9a6eebc64fc57ae0c469651de6))
* **purses:** redeem a purse token into the holder's balance ([a8f7fca](https://github.com/monygroupcorp/noema/commit/a8f7fca22fd04c909774696d5eb86a10be399e6c))


### Bug Fixes

* unmount the /tee static route ([796ecd9](https://github.com/monygroupcorp/noema/commit/796ecd96b1a8268a9047b821873fa4d359b92848))
* unmount the /tee static route ([80c7a02](https://github.com/monygroupcorp/noema/commit/80c7a0227eb108954cd9fdaff33599b906e940ed))


### Performance Improvements

* batch the pod caption pass instead of one image at a time ([0b09a00](https://github.com/monygroupcorp/noema/commit/0b09a0038da744c9936ccb6063cd6c2abaffaa6d))
* **crystal:** batch the pod caption pass instead of one image at a time ([87ea785](https://github.com/monygroupcorp/noema/commit/87ea7856a2fe2bcbaeba4ecf327bbeb652c6a352))

## [5.17.0](https://github.com/monygroupcorp/noema/compare/v5.16.0...v5.17.0) (2026-08-26)


### Features

* **api:** GET /v1/me/activity — one owner-scoped read of in-flight and settled runs ([485544d](https://github.com/monygroupcorp/noema/commit/485544def0b64b6348436852072b29d3acf0385f))
* **api:** GET /v1/me/activity — one owner-scoped read of in-flight and settled runs ([88bdfda](https://github.com/monygroupcorp/noema/commit/88bdfda653f079c3d4a8a1bf0ed613b4b1b2dd7c))
* **crystal:** add a GPT Image generation modus, de-canonise the DALL·E 3 lane ([d81047d](https://github.com/monygroupcorp/noema/commit/d81047daea6be27dc8c238230e5f9fc9695a3ba6))
* **crystal:** add a GPT Image generation modus, de-canonise the DALL·E 3 lane ([2f65e99](https://github.com/monygroupcorp/noema/commit/2f65e99f55f69a8cd3fe07c210d8271607ac14f0))
* **dataset:** show the active captionset's caption under each tile ([ec57f35](https://github.com/monygroupcorp/noema/commit/ec57f352b4f6cd36e2c96a5d8e731291bbd4f60c))
* **dataset:** show the active captionset's caption under each tile ([2de8086](https://github.com/monygroupcorp/noema/commit/2de8086d1e4ff4538990d524784ebde18a38ff7a))
* **derive:** persist training form as per-modus affines ([f29649f](https://github.com/monygroupcorp/noema/commit/f29649fe4c80c4b43ec98e79e08b8efcad00be59))
* **derive:** persist training form as per-modus affines ([adeefdd](https://github.com/monygroupcorp/noema/commit/adeefdddd40a4d8d82acdcfc9bea98539adc2081))
* **muse:** keeping a roll is a durable act ([affe046](https://github.com/monygroupcorp/noema/commit/affe0462673710fe3df8e3222ed80c0f94542bfa))
* **muse:** keeping a roll is a durable act ([2f82115](https://github.com/monygroupcorp/noema/commit/2f821158bc06ecc1a453710257795069a05e57d1))
* **status:** the Activity screen earns its name ([a91d1b8](https://github.com/monygroupcorp/noema/commit/a91d1b8be6813320ed7f31bef5c2acab51d99f82))
* **status:** the Activity screen earns its name ([5ca7ad8](https://github.com/monygroupcorp/noema/commit/5ca7ad848dd6edc20c2853ba889eedc25c8a5c6c))
* **web-app:** add the route walk screenshot harness ([393431f](https://github.com/monygroupcorp/noema/commit/393431fae47fd4156677549d24056347d1539e8f))
* **web-app:** the route walk — Playwright screenshot harness over every web route, axe-core riding it ([eb5bb36](https://github.com/monygroupcorp/noema/commit/eb5bb3677aef0780f0dda492d885902b556b5816))
* **web:** add token-drift stylelint gate ([39041b8](https://github.com/monygroupcorp/noema/commit/39041b8e972fa83c0e724ae7b5b75fe21b3517bb))
* **web:** add token-drift stylelint gate ([5458abd](https://github.com/monygroupcorp/noema/commit/5458abd4e0b7a03ac17c6a35acaa4663bf847a35))
* **web:** collapse TEE status copy to one roadmap line ([9c5fe52](https://github.com/monygroupcorp/noema/commit/9c5fe521fcf38fa6cc501eac4e28b24383204912))
* **web:** home leads with real activity, not the local chat list ([dc96565](https://github.com/monygroupcorp/noema/commit/dc96565e4a80f6436899b18184b8b3884733d35f))


### Bug Fixes

* **crystal:** declare the aditus ports the cursors already read ([143a3d7](https://github.com/monygroupcorp/noema/commit/143a3d7161793dea969971465c2d269283e87f1f))
* **crystal:** declare the aditus ports the cursors already read ([42b7e85](https://github.com/monygroupcorp/noema/commit/42b7e85acb0da996790c6d5c5ee64f4dc0e6552a))
* **crystal:** read only declared ports on the ApiCursor image generation rail ([61ef7c0](https://github.com/monygroupcorp/noema/commit/61ef7c0e57f0c8aec1741ab43af6eca92901a2bf))
* **crystal:** read only declared ports on the ApiCursor image generation rail ([6f6cf6a](https://github.com/monygroupcorp/noema/commit/6f6cf6aebf9dc6a06527df295adb4d9312f0ba6e))
* **crystal:** refuse undeclared aditus keys at the run-submit boundary ([54a0ccb](https://github.com/monygroupcorp/noema/commit/54a0ccb87a8eb5a6e56d347b93df270d091c360b))
* **crystal:** refuse undeclared aditus keys at the run-submit boundary ([af8a81b](https://github.com/monygroupcorp/noema/commit/af8a81ba1f7e40deda2b3d66b66d769b11d93903))
* **crystal:** stamp training owner from the resolved caller ([033e816](https://github.com/monygroupcorp/noema/commit/033e8168a5216ad5cb9b7da083206eb8bac9d6cf))
* **crystal:** stamp training owner from the resolved caller ([57b2feb](https://github.com/monygroupcorp/noema/commit/57b2febe3c664aec9110f53bca7cbb89251f961d))
* drop duplicate ActivityRow/ActivityKind type imports from merge ([17ddae7](https://github.com/monygroupcorp/noema/commit/17ddae707dfd5243e072995f4aa878d9d4d38e2b))
* **ledger:** mint change at reserve time so a reservation holds only its ceiling ([62ce91f](https://github.com/monygroupcorp/noema/commit/62ce91f1fec8b994274bcdaf00a8cb8ba15ba7d2))
* **ledger:** mint change at reserve time so a reservation holds only its ceiling ([5ff4fdb](https://github.com/monygroupcorp/noema/commit/5ff4fdb27d08a8a46e376eca9b55c31cfe49746c))
* **muse:** persist garden chip curation on the session floor ([1fe3e56](https://github.com/monygroupcorp/noema/commit/1fe3e5627dd6c60262214c6aea14c72be7eff4d0))
* regenerate app lockfile with npm 10 — optional platform entries missing, CI npm ci refused ([68eebd6](https://github.com/monygroupcorp/noema/commit/68eebd64d0546e5ebdfb76370f3d94a7519509d9))
* regenerate app lockfile with npm 10 — optional platform entries missing, CI npm ci refused ([fa5df08](https://github.com/monygroupcorp/noema/commit/fa5df082c46ad25dc3318a595e14a38c4eff9386))
* **web:** carry a caption run's id in the URL so it can be re-attached ([305a3f5](https://github.com/monygroupcorp/noema/commit/305a3f58946f8597d5fc17c51d8ba7aaece7819b))
* **web:** make the dataset garden's fragment chips read-only ([29bc1c4](https://github.com/monygroupcorp/noema/commit/29bc1c4e86239dde890d863328f5a8ae128eb669))
* **web:** make the dataset garden's fragment chips read-only ([5da49b4](https://github.com/monygroupcorp/noema/commit/5da49b4389985d0883eba3ef1f52b849dced3acd))
* **web:** resume curation queue from server-derived review state ([c89007d](https://github.com/monygroupcorp/noema/commit/c89007d1c71d503f1c6e2542bff7715902b59f41))
* **web:** resume curation queue from server-derived review state ([5ff6733](https://github.com/monygroupcorp/noema/commit/5ff67330b8ea733651465b4353cbf8e247cfc458))
* **web:** split live-attempt copy from between-attempts retry copy on the training run screen ([a913330](https://github.com/monygroupcorp/noema/commit/a91333026fff2d802e1d7930c45c112ddbc9de2e))
* **web:** split live-attempt copy from between-attempts retry copy on the training run screen ([fce7314](https://github.com/monygroupcorp/noema/commit/fce7314902051755888f1a0dbb0f00e610683c08))

## [5.16.0](https://github.com/monygroupcorp/noema/compare/v5.15.0...v5.16.0) (2026-08-25)


### Features

* **training:** keep a training request standing for a day instead of ending it at one attempt ([50dbc16](https://github.com/monygroupcorp/noema/commit/50dbc16cd8835a3f7b10075a7a8e9ecd381205d7))


### Bug Fixes

* correlate caption-arm pod logs by id, arm, and errorCode ([30b3fc3](https://github.com/monygroupcorp/noema/commit/30b3fc36527e5fadaf678448313e43b78c2d4015))
* correlate caption-arm pod logs by id, arm, and errorCode ([6f932bb](https://github.com/monygroupcorp/noema/commit/6f932bbb6fc6d5d11cf17d78f2c5cc63cac674cd))
* **crystal:** declare the muse-session surface's conflict error code ([88b2c51](https://github.com/monygroupcorp/noema/commit/88b2c51df9c294a94c064c37cbd061df5e6ccc0d))
* **crystal:** declare the muse-session surface's conflict error code ([2808c4b](https://github.com/monygroupcorp/noema/commit/2808c4b7d729f25cb17e99d5d8a1615fd26ed428))
* **crystal:** raise the ip-less bailout above the measured healthy attach floor ([69b32af](https://github.com/monygroupcorp/noema/commit/69b32af57005dca167b710e336ddb9e2f862b113))
* **crystal:** raise the ip-less bailout above the measured healthy attach floor ([bd2e335](https://github.com/monygroupcorp/noema/commit/bd2e3357d287618eb01b4e6bcfbca28560c883c0))
* **crystal:** re-provision a training pod that never becomes SSH-reachable ([5cefde7](https://github.com/monygroupcorp/noema/commit/5cefde7d72e1beabc8d7be9899b9b067cd711f70))
* **crystal:** resolve declared owned-resource references for the calling anima ([0559a58](https://github.com/monygroupcorp/noema/commit/0559a580a6fde004535ec3aa8928ed350f0f6650))
* **crystal:** resolve declared owned-resource references for the calling anima ([ce99ce3](https://github.com/monygroupcorp/noema/commit/ce99ce35bb04e82fb68b09ea98026e3f51ac95fc))
* **muse:** version Muse session writes so overlapping mutations cannot lose one another ([560b35b](https://github.com/monygroupcorp/noema/commit/560b35b3ad8f98e1613713b26db37f000c4dc07c))

## [5.15.0](https://github.com/monygroupcorp/noema/compare/v5.14.1...v5.15.0) (2026-08-24)


### Features

* **crystal:** rescan+rehost legacy-imported preview media ([7a1aae5](https://github.com/monygroupcorp/noema/commit/7a1aae5608b7816db561fa1f4bf5a2f5598139fb))
* **crystal:** rescan+rehost legacy-imported preview media ([2fbaf77](https://github.com/monygroupcorp/noema/commit/2fbaf77502261eb77e22ba22a254ee8cbe319f0a))
* **muse:** promote a Muse session into a draft collection ([c181826](https://github.com/monygroupcorp/noema/commit/c181826455467dc1289d98fac57ca1b93e32e3bf))
* **muse:** promote a Muse session into a draft collection ([a0ce560](https://github.com/monygroupcorp/noema/commit/a0ce5605ff58a09f5b1ee48fbbd361da45c44a92))


### Bug Fixes

* **crystal:** abandon a pod that stays RUNNING without a public IP and retry on a fresh one ([40d97ee](https://github.com/monygroupcorp/noema/commit/40d97eea5b804730346188b2ec22dcc423e16520))
* **crystal:** bound a detached caption pod that is locked and then never reports ([145488f](https://github.com/monygroupcorp/noema/commit/145488fe815309d95a4317efbf03d2bfe88783a4))
* **crystal:** bound a detached caption pod that is locked and then never reports ([e93f828](https://github.com/monygroupcorp/noema/commit/e93f8282bd2582770cbde57b14c993cb436fc9a0))
* **crystal:** scope a fired collection's flow change to its funder ([e114ed9](https://github.com/monygroupcorp/noema/commit/e114ed9f9b1ac886bff84b56394b384e2c4fced7))
* **crystal:** scope a fired collection's flow change to its funder ([6091a17](https://github.com/monygroupcorp/noema/commit/6091a17645f948ee4b3243f90e4b03f3fbf240c0))
* **migrations:** load private compliance via variable-path dynamic import ([8f5f935](https://github.com/monygroupcorp/noema/commit/8f5f935773f67f4c08283b8eda9881624a488bc7))
* **site:** align privacy claims with the published privacy policy ([b07573b](https://github.com/monygroupcorp/noema/commit/b07573b96d5d73bdab27980b879f9bfb9ebf7b5b))
* **site:** align privacy claims with the published privacy policy ([0fcaa0d](https://github.com/monygroupcorp/noema/commit/0fcaa0d2462ad7cb80291a898a4d34deaad26115))

## [5.14.1](https://github.com/monygroupcorp/noema/compare/v5.14.0...v5.14.1) (2026-08-24)


### Bug Fixes

* **crystal:** give the caption pod a torchvision matched to its torch ([51450f6](https://github.com/monygroupcorp/noema/commit/51450f65a9cfa3c91947432912a15cdc3b0b530a))

## [5.14.0](https://github.com/monygroupcorp/noema/compare/v5.13.0...v5.14.0) (2026-08-22)


### Features

* **muse:** the nozzle, run shape and standing affix survive a reload ([ddde38d](https://github.com/monygroupcorp/noema/commit/ddde38dff6649c19ce7c31d15279e33b410acc5e))


### Bug Fixes

* **muse:** fire a hand-picked prompt under the chosen model ([5793834](https://github.com/monygroupcorp/noema/commit/5793834831468f099ac98300a37a14c419ddfbde))
* **muse:** fold the run banner to one line while a stream is live ([da47a63](https://github.com/monygroupcorp/noema/commit/da47a63ba249f3a4a4e2801e6cb7b89201a2d5cb))

## [5.13.0](https://github.com/monygroupcorp/noema/compare/v5.12.0...v5.13.0) (2026-08-22)


### Features

* **muse:** let a hand collapse the run controls and steer dock at any time ([a70274d](https://github.com/monygroupcorp/noema/commit/a70274deba7070526aa84b6734b10d5b99e28002))


### Bug Fixes

* **web:** put dataset actions before the media grid on a phone ([cd5ba3f](https://github.com/monygroupcorp/noema/commit/cd5ba3ff0610fdd5c9cce99991b086544b38edc8))

## [5.12.0](https://github.com/monygroupcorp/noema/compare/v5.11.0...v5.12.0) (2026-08-21)


### Features

* **crystal:** a caption pass extends the captionset it was given ([d7c3d29](https://github.com/monygroupcorp/noema/commit/d7c3d291d5f3be3aa515d6d05648cbbeadb3db64))
* **datasets:** remove an image, archive a set, and take either back ([7527e9c](https://github.com/monygroupcorp/noema/commit/7527e9c5d9bfb01c77cc5b485bf186f236535df5))
* **muse:** a session history off the dataset, and every past piece rehydrated from its run ([4dcc88a](https://github.com/monygroupcorp/noema/commit/4dcc88a10bc384e0ced286de257fc2a6698fb28a))
* **muse:** every running piece reads its live phase ([cfdedb9](https://github.com/monygroupcorp/noema/commit/cfdedb99d57a9d82900e0294c1bb78797f81fa35))
* **muse:** every running piece reads its live phase ([f808c43](https://github.com/monygroupcorp/noema/commit/f808c43a6886685d2ca831ba58d2eda594f68eae))
* **muse:** name the cold start on a deep LoRA stack ([64b9a3c](https://github.com/monygroupcorp/noema/commit/64b9a3ce7fd6190a302beaabab4b1400a1d89d6c))
* **muse:** the nozzle takes a stack — fire under more than one LoRA at a time ([0f55f28](https://github.com/monygroupcorp/noema/commit/0f55f28423589b93fd0a5f18567fed10cbf93ca6))
* **muse:** the nozzle takes a stack — fire under more than one LoRA at a time ([568e86c](https://github.com/monygroupcorp/noema/commit/568e86c49b0a47f8c1aa5e7449179b617bb1c78f))
* **web:** give the dataset screen's actions their real weight ([6cf4c39](https://github.com/monygroupcorp/noema/commit/6cf4c39353fd07615f53665a45412c66d52c0abb))
* **web:** give the dataset screen's actions their real weight ([9ca0deb](https://github.com/monygroupcorp/noema/commit/9ca0deb48d447e1b4ee085fc68ab193a30bd63f3))


### Bug Fixes

* **crystal:** the caption and decompose modi declare every port their cursors read ([766491b](https://github.com/monygroupcorp/noema/commit/766491b6ffa959d9c22eeb29552cd1e5c7a7a568))
* **muse:** a disabled gesture says why — the reaction rail no longer goes quiet on a piece the ledger never took ([cda752f](https://github.com/monygroupcorp/noema/commit/cda752fba46eb9a7462993d21576ae8472c6bccd))
* **muse:** a disabled gesture says why it is refused ([1c52e11](https://github.com/monygroupcorp/noema/commit/1c52e11193b7de475ba3570fc723fe941fba6ca0))
* **muse:** decompose only what has not been decomposed, and refuse a pass with nothing to do ([7135d95](https://github.com/monygroupcorp/noema/commit/7135d95ee8e65d344dff8f3406c28af183e2c2df))
* **muse:** reconcile a session's floor with its mother's garden on resume ([02f422d](https://github.com/monygroupcorp/noema/commit/02f422d57f0d884beac9566f82fd475ad659d783))
* **muse:** reconcile a session's floor with its mother's garden on resume ([40587ef](https://github.com/monygroupcorp/noema/commit/40587efb81339efc0ad9e26ebbdaec98263af809))
* **space:** a single click on a point selects it without moving the camera ([5a6ed18](https://github.com/monygroupcorp/noema/commit/5a6ed18cd247ff7a6e16d459aa8e70af81cea349))

## [5.11.0](https://github.com/monygroupcorp/noema/compare/v5.10.1...v5.11.0) (2026-08-21)


### Features

* **crystal:** report a caption pass while it runs ([00644fc](https://github.com/monygroupcorp/noema/commit/00644fc6e402ab77142a36dd90296e657b06505e))
* **datasets:** archive a dataset or one of its images, reversibly ([ab41d1d](https://github.com/monygroupcorp/noema/commit/ab41d1d3f7d0c501ef52515644c638aa982f4b55))
* **datasets:** archive a dataset or one of its images, reversibly ([c15b093](https://github.com/monygroupcorp/noema/commit/c15b0931fb82a7aab24a4738b64b2b66689a358b))
* **web:** add images to a dataset from the dataset screen ([2d41297](https://github.com/monygroupcorp/noema/commit/2d41297848c6a96755d8a0a99a4784a9c720065f))
* **web:** add images to a dataset from the dataset screen ([c0a2886](https://github.com/monygroupcorp/noema/commit/c0a28861dd24daeb0c01761ae5045fabd9b7d79e))


### Bug Fixes

* **muse:** make the model picker reachable and let the stream own the viewport ([6103561](https://github.com/monygroupcorp/noema/commit/61035610110e99b22db62130e8c59cadf437d84c))
* **muse:** make the model picker reachable and let the stream own the viewport ([7fc9f2d](https://github.com/monygroupcorp/noema/commit/7fc9f2df766be2af6f204f4f9cc0e72c76831468))
* **muse:** one decompose at a time per dataset, and a deadline on every chat call ([c13ca91](https://github.com/monygroupcorp/noema/commit/c13ca914adf337107e348a508ee108d0843fcd27))
* **muse:** one decompose at a time per dataset, and a deadline on every chat call ([cba9201](https://github.com/monygroupcorp/noema/commit/cba9201aeffa2b616c1fd6c538569e1cc9c556cf))


### Performance Improvements

* **crystal:** run a caption pass on its own lean pod ([8d4b359](https://github.com/monygroupcorp/noema/commit/8d4b3599577ad05b99f94672c1504ce3311d4ed6))
* **crystal:** run a caption pass on its own lean pod ([253822f](https://github.com/monygroupcorp/noema/commit/253822ffa1088f0e151360810177e7fc8bda144a))

## [5.10.1](https://github.com/monygroupcorp/noema/compare/v5.10.0...v5.10.1) (2026-08-21)


### Bug Fixes

* **muse:** carry a run's outputs in the terminal it announces ([3b632c5](https://github.com/monygroupcorp/noema/commit/3b632c542fcdc0b0e08ad1ce9102d7a9313fa7cc))
* **muse:** rebuild a resumed session's stream from its ledger ([aef7639](https://github.com/monygroupcorp/noema/commit/aef7639e2f146d955a98abe8912f6f48bbe60ca2))

## [5.10.0](https://github.com/monygroupcorp/noema/compare/v5.9.0...v5.10.0) (2026-08-21)


### Features

* **muse:** a LoRA control on the stream, and a hold while the nozzle changes ([374cf9d](https://github.com/monygroupcorp/noema/commit/374cf9d8a124746f1ae0377ec6452b831db1e5f1))
* **muse:** a LoRA control on the stream, and a hold while the nozzle changes ([b0717e4](https://github.com/monygroupcorp/noema/commit/b0717e413d786891afb87566d23f1bba18e7eef6))
* **muse:** add images to the moodboard from the Muse screen ([86bbd53](https://github.com/monygroupcorp/noema/commit/86bbd5382daafd64ed6125fafe412b5b5b37680e))
* **muse:** configure a stream, launch once, and it rides until you stop it ([229888d](https://github.com/monygroupcorp/noema/commit/229888d2156f3e63603472c17d71d12e1af05fa8))
* **muse:** steer a session floor with a short instruction, as a proposal ([d8b47c6](https://github.com/monygroupcorp/noema/commit/d8b47c610a6157535083ecc3744e7e3320ae2f6a))
* **muse:** steer the floor from a keyboard, through a consent sheet ([9a686bc](https://github.com/monygroupcorp/noema/commit/9a686bca646855afc0086f66be703056b249c248))


### Bug Fixes

* keep startup non-fatal and bounded when Telegram cannot start ([1c43147](https://github.com/monygroupcorp/noema/commit/1c43147db75529a2185ddb949052473769c9e27f))
* **telegram:** let the startup timeouts actually fire ([69c337d](https://github.com/monygroupcorp/noema/commit/69c337d09c0eb049f6938cb82306568705c66185))

## [5.9.0](https://github.com/monygroupcorp/noema/compare/v5.8.0...v5.9.0) (2026-08-20)


### Features

* **crystal:** give the muse session a floor and a piece ledger with lineage ([ee5c5c0](https://github.com/monygroupcorp/noema/commit/ee5c5c08fb3ec471896bdcdb119840f948e8ec6d))
* **crystal:** give the muse session a floor and a piece ledger with lineage ([d775b5f](https://github.com/monygroupcorp/noema/commit/d775b5fcf2d66a328ea453ac7eee879bebfb4d11))
* **crystal:** let the muse sampler read per-fragment enabled and weight state ([a2cf9f9](https://github.com/monygroupcorp/noema/commit/a2cf9f9d694f1e0d36062f2dceaae56c89b04b93))
* **datasets:** append media to an existing dataset ([949020e](https://github.com/monygroupcorp/noema/commit/949020eb11353d8fa5283e5a1eb1252abebf6677))
* **datasets:** append media to an existing dataset ([b68fb54](https://github.com/monygroupcorp/noema/commit/b68fb546819a48366d653e5d0b38eafbcbfafc1f))
* **muse:** add a fragment to a session floor by hand ([0cd83a8](https://github.com/monygroupcorp/noema/commit/0cd83a8895f945e0efd191300b9567e32d84ff4d))
* **muse:** add a fragment to a session floor by hand ([fd9c1be](https://github.com/monygroupcorp/noema/commit/fd9c1be6c55f88c3177682c7687a560f6fbde6c6))
* **muse:** persist a Muse session and serve it over /v1 ([85f0b5a](https://github.com/monygroupcorp/noema/commit/85f0b5ae55a074babb86ea9495d2ab5b13bc658c))
* **muse:** persist a Muse session and serve it over /v1 ([1e6a804](https://github.com/monygroupcorp/noema/commit/1e6a80461aa2a3dda33bb3347892b7d03b024d7e))
* **muse:** read how much variance the cutting floor has left ([a6dae01](https://github.com/monygroupcorp/noema/commit/a6dae0147eec1509977986e9cb6ddc52b6d9163e))
* **muse:** save a piece back into the session's own dataset ([ebd7883](https://github.com/monygroupcorp/noema/commit/ebd78830d7d288c709d6eb2450fbf7d40cf4e042))
* **muse:** show fired pieces in Muse as a tile grid ([1b9d154](https://github.com/monygroupcorp/noema/commit/1b9d15453b929896f0cf4f164314ba1a5614713b))
* **muse:** the cutting floor sheet, and reactions that write to the session ([3bd8c22](https://github.com/monygroupcorp/noema/commit/3bd8c22b87912a70b51853ae082f87ad033b80a3))
* **muse:** the cutting floor sheet, and reactions that write to the session ([b3a37b0](https://github.com/monygroupcorp/noema/commit/b3a37b0ccf0967e127ff98fde8c1ad590d119745))
* **muse:** update a recorded piece, and look a session up by dataset ([66c7595](https://github.com/monygroupcorp/noema/commit/66c7595f76b68fc616d030e35351592d01d9eaee))
* **muse:** update a recorded piece, and look a session up by dataset ([0f8a6c0](https://github.com/monygroupcorp/noema/commit/0f8a6c0034fc94a806fa5b7a84228c96aa05a082))


### Bug Fixes

* **api:** declare not_found.dataset and key the authz coverage guard on the resource ([a7a8856](https://github.com/monygroupcorp/noema/commit/a7a8856b047f57121fdb4e826f5465ed36c0c0f9))
* **api:** declare not_found.dataset and key the authz coverage guard on the resource ([f27c029](https://github.com/monygroupcorp/noema/commit/f27c02923b03b673d074a4f2c83a8349cd5bc771))
* **telegram:** render resolved inputs as labels, and keep quiet in shared groups ([dd8091e](https://github.com/monygroupcorp/noema/commit/dd8091e517cbd104fab0c2163e30c210b4fdc5ce))
* **telegram:** render resolved inputs as labels, and keep quiet in shared groups ([19aa351](https://github.com/monygroupcorp/noema/commit/19aa351a2ede51e7da2ed038476269acc9a46bd3))

## [5.8.0](https://github.com/monygroupcorp/noema/compare/v5.7.1...v5.8.0) (2026-08-18)


### Features

* **datasets:** fire a decompose from Muse and the captionset panel ([9daf391](https://github.com/monygroupcorp/noema/commit/9daf39123d67510ccaae81cc1aa70326534d453e))


### Bug Fixes

* **crystal:** return the pod-rail launch at provisioning, finish the bootstrap in the background ([b395039](https://github.com/monygroupcorp/noema/commit/b3950393c9459973a4a0212335ef25511d39892d))

## [5.7.1](https://github.com/monygroupcorp/noema/compare/v5.7.0...v5.7.1) (2026-08-18)


### Bug Fixes

* **execution:** derive an actum's expiry from the work it reserved ([d1a3ab5](https://github.com/monygroupcorp/noema/commit/d1a3ab5bfcbb3fe7e289dbe709e3f174b2755b51))
* **execution:** derive an actum's expiry from the work it reserved ([142c83c](https://github.com/monygroupcorp/noema/commit/142c83cc37ed81abe9139744a826ed22d3abfc08))

## [5.7.0](https://github.com/monygroupcorp/noema/compare/v5.6.0...v5.7.0) (2026-08-18)


### Features

* **concierge:** auto-open panel on first visit to a route ([df70675](https://github.com/monygroupcorp/noema/commit/df70675adf8ed72d8d1d672cb56b8b844f026a3d))
* **crystal:** decompose a dataset's captionset into prompt fragments ([b8ea20a](https://github.com/monygroupcorp/noema/commit/b8ea20a5595a0e990cdacec4448eb9110219200f))
* **crystal:** decompose a dataset's captionset into prompt fragments ([7ec8933](https://github.com/monygroupcorp/noema/commit/7ec89334527ef90941baee44940510f6307ef11c))
* **muse:** fire a mined prompt at a text-to-image workflow ([ba68bfd](https://github.com/monygroupcorp/noema/commit/ba68bfd0e3ed094f6e802b8bcd27ecc56983be96))
* **web:** Muse P3 — the dataset-wide garden screen ([16253c4](https://github.com/monygroupcorp/noema/commit/16253c4c29ef14ace9c4e9603306767a97d9123c))
* **web:** Muse P3 — the dataset-wide garden screen ([3078745](https://github.com/monygroupcorp/noema/commit/3078745806f18e20ce27713352ea0409d6769fc7))


### Bug Fixes

* **build:** mirror the repo layout in the web app's docker stage ([b056a66](https://github.com/monygroupcorp/noema/commit/b056a66a8d2f7746ff1c2177c09e3de47a60dfe8))
* **crystal:** match muse conflict place words on word boundary ([229bd42](https://github.com/monygroupcorp/noema/commit/229bd42b603c2a94fd5ed9e8cea068290176816c))
* **crystal:** match muse conflict place words on word boundary ([7795505](https://github.com/monygroupcorp/noema/commit/779550589b665aa8c188758687aeb3f631b0efec))
* **crystal:** pin concierge default chat model to qwen3.8-27b ([63c1af4](https://github.com/monygroupcorp/noema/commit/63c1af4f660562fb63ce6d0667525b94e60647cc))
* **crystal:** pin concierge default chat model to qwen3.8-27b ([3f1f3c8](https://github.com/monygroupcorp/noema/commit/3f1f3c8a635822878abaedc68646d7ef4681eeb4))

## [5.6.0](https://github.com/monygroupcorp/noema/compare/v5.5.0...v5.6.0) (2026-08-17)


### Features

* **api:** add an internal grant route for crediting a plain account ([2bb6c30](https://github.com/monygroupcorp/noema/commit/2bb6c30e4a0237ea067fc279b2a01d351ac05fc2))
* **canvas:** node parameter panel — edit a node's aditus before minting ([6627d34](https://github.com/monygroupcorp/noema/commit/6627d34fcd551f0f9039fcc5573bb9bf301d2eef))
* **canvas:** open a minted flow from its catalog card back into Canvas ([660f87a](https://github.com/monygroupcorp/noema/commit/660f87a3b43563d6eba52bbd78400436f8db79f2))
* **canvas:** open a minted flow from its catalog card back into Canvas ([d95e54a](https://github.com/monygroupcorp/noema/commit/d95e54a5e4f31cf224fcf8e93712911d858dc822))
* **crystal:** a fired collection's base flow can be changed ([a1a9f6c](https://github.com/monygroupcorp/noema/commit/a1a9f6cb5cebfbfad8c276b7c4b70cd6ac84266d))
* **crystal:** muse prompt-fragment taxonomy, sampler and template weaver ([98a8c03](https://github.com/monygroupcorp/noema/commit/98a8c03ada27b395748f89f61e8ff0053822fd76))
* **muse:** build a fragment garden from captions and roll readable prompts ([de3de6c](https://github.com/monygroupcorp/noema/commit/de3de6ce8d01e8fdda30546ed5a11fe325a9f436))
* **muse:** render dataset item fragments as a curatable chip garden ([4ce4871](https://github.com/monygroupcorp/noema/commit/4ce4871bac581c36fa539999f9491e28a530b922))


### Bug Fixes

* **api:** surface an underfunded run as 402 instead of a generic 500 ([c26914e](https://github.com/monygroupcorp/noema/commit/c26914e7ef1bb129f9cfc56e853fcc932aeacacf))
* drop retracted privacy claim from index.html meta tags ([9bde7dd](https://github.com/monygroupcorp/noema/commit/9bde7dd6df51b13034a7c04e60215bc35571c2bc))
* **economy:** return 402 for shortfalls on the arcanum and bursa spend paths ([ae5bfc0](https://github.com/monygroupcorp/noema/commit/ae5bfc06c68cb7d7dc935a070f3160c401a14a78))
* prompt-axis value no longer clobbered + new collections seed a working example ([9905ee6](https://github.com/monygroupcorp/noema/commit/9905ee690767890cadeaedb9962a22c3a8bd38ab))
* remove client method for a training-cost route that does not exist ([8181460](https://github.com/monygroupcorp/noema/commit/8181460f871c065497553c36148428ecddddca9a))
* update canvas publish button copy to match publish terminology ([38781c5](https://github.com/monygroupcorp/noema/commit/38781c576db8a2bcbc06f394e78970ee71bd0357))
* update canvas publish button copy to match publish terminology ([1ca28bd](https://github.com/monygroupcorp/noema/commit/1ca28bddf6857851ef6256968aaaf0f31893c530))

## [5.5.0](https://github.com/monygroupcorp/noema/compare/v5.4.1...v5.5.0) (2026-08-14)


### Features

* **crystal:** batch caption a whole dataset in one metered run ([17e5b50](https://github.com/monygroupcorp/noema/commit/17e5b5032f32a47ebaee74b8f3ad0ca41105a088))
* **datasets:** caption a dataset, choose its captionset, and train from it ([9d58e40](https://github.com/monygroupcorp/noema/commit/9d58e40b996bc615372d3e5a9c6575a83ff38fb8))
* **datasets:** captionset caption text, a write+edit seam, and two owner-scoped routes ([08298fc](https://github.com/monygroupcorp/noema/commit/08298fc5902ac5029196b991bf03df6ffa07b6d2))
* **datasets:** captionset caption text, a write+edit seam, and two owner-scoped routes ([190e532](https://github.com/monygroupcorp/noema/commit/190e532d9b864781625b038bee0d01383c138793))

## [5.4.1](https://github.com/monygroupcorp/noema/compare/v5.4.0...v5.4.1) (2026-08-14)


### Bug Fixes

* **telegram:** one /arm card per fundament, named by itself, paginated ([4215bd8](https://github.com/monygroupcorp/noema/commit/4215bd8ec010757edd570f5ed62d1ea84ca029eb))
* **telegram:** one /arm card per fundament, named by itself, paginated ([0cfae5d](https://github.com/monygroupcorp/noema/commit/0cfae5de1a051b924e607363575fb3b4a18823b8))

## [5.4.0](https://github.com/monygroupcorp/noema/compare/v5.3.0...v5.4.0) (2026-08-14)


### Features

* **crystal:** declare directed LoRA compatibility per substrate ([337f239](https://github.com/monygroupcorp/noema/commit/337f2395a0b62818fbf840adbeb2bfa826c62a45))
* **crystal:** declare directed LoRA compatibility per substrate ([5e8b7fe](https://github.com/monygroupcorp/noema/commit/5e8b7fe983a99c0acc0a115479c3d836306b4121))


### Bug Fixes

* **crystal:** ask the runner whether a job is alive instead of inferring it ([a4db7c7](https://github.com/monygroupcorp/noema/commit/a4db7c7a20ba6133b6a139b562e90e10167636ad))
* **migrations:** correct the impossible read-form docs on the live-db guard ([9a2820d](https://github.com/monygroupcorp/noema/commit/9a2820db8761e9aef96eb4cf4adbc41d80b6d3bb))
* repair klein-4b familia and publish the klein LoRA collection ([30a601b](https://github.com/monygroupcorp/noema/commit/30a601b79491d9a650c4ac6b135007568eb55029))
* **telegram:** scope the studio LoRA picker to the substrate's accepted families ([63211ce](https://github.com/monygroupcorp/noema/commit/63211ce636b93907d706ce8cd655f251325e3d82))
* **telegram:** scope the studio LoRA picker to the substrate's accepted families ([0cfe717](https://github.com/monygroupcorp/noema/commit/0cfe717164a71e6e90b2c060fb9106c8930ea8e1))

## [5.3.0](https://github.com/monygroupcorp/noema/compare/v5.2.0...v5.3.0) (2026-08-12)


### Features

* **migrations:** backfill Intella.samples from previewUris ([92b6365](https://github.com/monygroupcorp/noema/commit/92b63657c60ab48b2d0b84b6f68ae5b45465b0f8))
* **migrations:** backfill Intella.samples from previewUris ([79b9122](https://github.com/monygroupcorp/noema/commit/79b9122e5242fecf0535290373095c0824f2db7c))


### Bug Fixes

* **crystal:** exclude expired warmUntil pods from findWarm's claim filter ([c755402](https://github.com/monygroupcorp/noema/commit/c75540290daa1b128dccad39e5fd8db7b043a6fd))
* **crystal:** exclude expired warmUntil pods from findWarm's claim filter ([5945cd8](https://github.com/monygroupcorp/noema/commit/5945cd8c2af323071f9a6b9237a06ad7210c9a04))
* **crystal:** repoint dangling LoRA baseIntellaId pointers to real catalog ids ([c60876d](https://github.com/monygroupcorp/noema/commit/c60876d5ac9748db753cb378984ee145421c1187))
* **import:** keep origin previews when the preview scan does not pass ([33b90e5](https://github.com/monygroupcorp/noema/commit/33b90e527108ce9843b895fb7b03694d4d4cb435))
* **migrations:** correct inverted --db production guard ([70b87b3](https://github.com/monygroupcorp/noema/commit/70b87b3b917cc51933fc909b25f2b393244f24bc))
* **migrations:** correct inverted --db production guard ([5369938](https://github.com/monygroupcorp/noema/commit/53699381075ce736be16d9ffe42670ed44d3e28a))
* **telegram:** scope flow context to the originating chat ([87bb0bf](https://github.com/monygroupcorp/noema/commit/87bb0bfcbd3123db6a258d2611079139af81168d))

## [5.2.0](https://github.com/monygroupcorp/noema/compare/v5.1.3...v5.2.0) (2026-08-10)


### Features

* **import:** derive an imported model's content rating from the origin signal ([40ff751](https://github.com/monygroupcorp/noema/commit/40ff7510391e70c53bdfbfa6c83de9cd7f57f980))
* **import:** derive an imported model's content rating from the origin signal ([23e8a59](https://github.com/monygroupcorp/noema/commit/23e8a597d810f9f50a751db93752521e8c274595))
* **migrations:** backfill contentRating on already-imported models from the captured origin nsfw flag ([95eb004](https://github.com/monygroupcorp/noema/commit/95eb0049b84be73695fe25f160c449b6abec9ca7))
* **migrations:** backfill contentRating on already-imported models from the captured origin nsfw flag ([7631fe9](https://github.com/monygroupcorp/noema/commit/7631fe9d67d0b3f137f26600969156203e678459))
* **migrations:** backfill contentRating on reviewed legacy LoRAs ([7e9784f](https://github.com/monygroupcorp/noema/commit/7e9784f2a17c4af699b3758ea5fe6f54217707c8))


### Bug Fixes

* align Dockerfile Node base image with CI's Node 22 ([7832e91](https://github.com/monygroupcorp/noema/commit/7832e9172f2c43b4a5a7596a2f25999f63074eb3))
* align Dockerfile Node base image with CI's Node 22 ([d9d8fe7](https://github.com/monygroupcorp/noema/commit/d9d8fe75fcaedc58434de703865a5a919b325d26))
* **catalog:** exempt a caller's own models from the adult filter in listModels ([e7192c8](https://github.com/monygroupcorp/noema/commit/e7192c8a05ee21e16867a3f832e9f14411e61d7d))
* **catalog:** exempt a caller's own models from the adult filter in listModels ([eb87c53](https://github.com/monygroupcorp/noema/commit/eb87c530a0779e25377ded8e9b6e47a802ea5f93))
* **crystal:** repair dead HuggingFace intella download URIs after the org rename ([bc737f7](https://github.com/monygroupcorp/noema/commit/bc737f75f74e5133b2891114d5511d8d447be501))
* **crystal:** repair dead HuggingFace intella download URIs after the org rename ([14ec714](https://github.com/monygroupcorp/noema/commit/14ec7145b75e7186ac89bc493172140460ca2f3e))
* **internal-api:** make credential checks unconditional and assert configuration at boot ([d063a5a](https://github.com/monygroupcorp/noema/commit/d063a5a4bd45415ae7ab8e0386a0a56193aa6ae3))
* **webhooks:** bind each execution callback to the job it reports ([6ebe580](https://github.com/monygroupcorp/noema/commit/6ebe5802d1a665029ae6bc9339f2ccc17289326b))

## [5.1.3](https://github.com/monygroupcorp/noema/compare/v5.1.2...v5.1.3) (2026-08-09)


### Bug Fixes

* **allocutio:** resolve auth before erasure feature-state on DELETE /v1/me ([1b4b36d](https://github.com/monygroupcorp/noema/commit/1b4b36db978f2a2db9a4b5b34047373a2f7ab54b))
* **api:** scope a run's studio binding to the resolved caller ([a51b06f](https://github.com/monygroupcorp/noema/commit/a51b06fc9f5eaa0516cf1ab1ea1f56e8a38a3d0f))

## [5.1.2](https://github.com/monygroupcorp/noema/compare/v5.1.1...v5.1.2) (2026-08-09)


### Bug Fixes

* **crystal-api:** getMe propagates ledger-dep failure instead of a zero balance ([648a7f7](https://github.com/monygroupcorp/noema/commit/648a7f7e905c9c4125ea4eba7a5746267a12f3dd))
* **crystal:** webhook rail's baseImpetus comment and test mock reflect post-167 settlement ([8747f0f](https://github.com/monygroupcorp/noema/commit/8747f0f3bdc178fa193bcf53d8cc9a43c0d08a51))
* **tests:** forward captured stdout to the original write in lib tests ([9d446ac](https://github.com/monygroupcorp/noema/commit/9d446acd4c155491f21760228ad874cbe8d1850f))
* **vestigia:** scope search visibility to the resolved caller (CRIT-1) ([32f13aa](https://github.com/monygroupcorp/noema/commit/32f13aae85160355137cb6201a0be295168ab4b5))

## [5.1.1](https://github.com/monygroupcorp/noema/compare/v5.1.0...v5.1.1) (2026-08-08)


### Bug Fixes

* **release:** stop CLA lock from starving the container build ([1a265f6](https://github.com/monygroupcorp/noema/commit/1a265f6d0687cf700a858a19a74d91783bb76355))

## [5.1.0](https://github.com/monygroupcorp/noema/compare/v5.0.1...v5.1.0) (2026-08-08)


### Features

* **web:** guard unsaved trait edits against navigation ([804318d](https://github.com/monygroupcorp/noema/commit/804318da43fa0b29b4d9e31daf122031a6b49d9e))

## [5.0.1](https://github.com/monygroupcorp/noema/compare/v5.0.0...v5.0.1) (2026-08-07)


### Bug Fixes

* **deploy:** fail-safe alias swap + cap container log growth ([54d1dac](https://github.com/monygroupcorp/noema/commit/54d1dace65cd3caa776192e3514e730bbddaf6e8))
* **test:** expand test globs in the shell so the suites run on Node 20 ([dee567b](https://github.com/monygroupcorp/noema/commit/dee567bcc5736f8d5e580eccf89107b2fb7fc182))
* **web:** SERVE_WEB_APP replaces STAGING_FRONTEND ([bee00c2](https://github.com/monygroupcorp/noema/commit/bee00c29b19c60879fc2b38334f03d5099ac7131))

## [5.0.0](https://github.com/monygroupcorp/noema/compare/v4.11.15...v5.0.0) (2026-08-05)


### ⚠ BREAKING CHANGES

* replaces the legacy stationthisdeluxebot app with the crystal app. Legacy JS API surface removed; accounts and LoRAs migrated to the noemaplane DB.

### Features

* **account:** wire Profile + Preferences onto owner-keyed settings (Consuetudo) ([ff21283](https://github.com/monygroupcorp/noema/commit/ff21283f7138bd037a0a3b76c935d850c4e912b6))
* **agent-card:** ERC-8004 agent cards — the discoverable x402 surface (§7/§8) ([8a53ad6](https://github.com/monygroupcorp/noema/commit/8a53ad6d5bca0064cb05d219f697e5f1c61c9ddd))
* **api:** GDPR account data export (POST /v1/me/export) ([9efb4f3](https://github.com/monygroupcorp/noema/commit/9efb4f3c0bb1a652df0ea380c62b7b9d319d77af))
* **api:** per-run spend ledger (GET /v1/me/runs) ([2aebf7c](https://github.com/monygroupcorp/noema/commit/2aebf7cdcf635c7f6a07d5f44bfd6afc0be4aa63))
* **auth:** fiat username/password rail — register/verify/login + session minting ([9774be3](https://github.com/monygroupcorp/noema/commit/9774be32d4e8c84df6c38573a39f9bcc34a0be5c))
* **auth:** username+password backend with wallet + Telegram recovery ([805d1fe](https://github.com/monygroupcorp/noema/commit/805d1fe6020999bbb280014b14d98909798a6750))
* **bulletin:** render training step/ETA progress in the session bulletin ([2d52aca](https://github.com/monygroupcorp/noema/commit/2d52aca3cb807d8d0be98c442c3ce59478bf27b7))
* **ceremony:** in-browser contribution flow (snarkjs in WASM) ([7645781](https://github.com/monygroupcorp/noema/commit/764578182b01e1a4f68f69d3ff9af583dbfe7218))
* **ceremony:** live sequencer — self-serve contributions, no redeploy ([4949088](https://github.com/monygroupcorp/noema/commit/494908805166d6207bd693c5c34b547d829da17f))
* **ceremony:** npm run ceremony:finalize — capture head + beacon in one command ([067b9d5](https://github.com/monygroupcorp/noema/commit/067b9d56482f397fb7392adf255683475c517654))
* **ceremony:** public Arcanum trusted-setup page + coordinator endpoints ([9b7b5f1](https://github.com/monygroupcorp/noema/commit/9b7b5f178725abe04b297b23c20705cda226e739))
* **collections:** curation queue — add list-pieces read + wire the review UI ([544cf24](https://github.com/monygroupcorp/noema/commit/544cf248db82cd061f8f4d68f5722b07c0a0c95c))
* **collections:** export/publish destinations + draft lifecycle + trait/rule CRUD ([c6c33ae](https://github.com/monygroupcorp/noema/commit/c6c33aedd23621baa5c3619e0363d593bceea7f5))
* **collections:** wire CanonicRun to live progress + rarity polling ([d34f87f](https://github.com/monygroupcorp/noema/commit/d34f87fe451fedd4af167d3125e009904e823ed4))
* **collections:** wire the collections front door (list + create + hub) ([60132b8](https://github.com/monygroupcorp/noema/commit/60132b8c80f4f79c6c681d14ff3042589b8aa3cf))
* **compliance:** CsamReviewReporter port + confirm-and-report tests ([a0b1ad3](https://github.com/monygroupcorp/noema/commit/a0b1ad371f01cc7387aa0f4b5fb2b51814674f32))
* **compliance:** OFAC sanctions screening on CreditVault deposits ([e1cef80](https://github.com/monygroupcorp/noema/commit/e1cef806e0ee9f742cbc089c17d36862a337302a))
* **compliance:** offline batch triage over the stored Actum corpus (A3) ([ea1d918](https://github.com/monygroupcorp/noema/commit/ea1d918e7b2b900d9168b0773f59098b114e7348))
* **compliance:** verdict cache + billable-gated scan fee (A4) ([cb2c57b](https://github.com/monygroupcorp/noema/commit/cb2c57b1c4a63635a4cb8b4b8f65bf3ecb0edb03))
* **crystal:** STATIONTHIS flagship custom modus on FLUX.2 Klein 4B ([0360305](https://github.com/monygroupcorp/noema/commit/0360305ba9c57505e677467f97851153283db645))
* **cursor:** declarative ApiCursor for hosted-API inference (JS-nuke [#12](https://github.com/monygroupcorp/noema/issues/12)) ([bf8caa0](https://github.com/monygroupcorp/noema/commit/bf8caa08b787e660f1668cfe383e62c7a0fb3bd9))
* cut over to crystal app (chainengine-migration) ([9fbe595](https://github.com/monygroupcorp/noema/commit/9fbe595035700c20c32cae1c29672a245ed31f66))
* **delegation:** agent-balance invite tokens — the widget's entrance (§7) ([11a2bd1](https://github.com/monygroupcorp/noema/commit/11a2bd1174da04a02ff997f5fe0115690489f34e))
* **feed:** wire the public feed + publish-to-feed to the backend ([7a1d3ee](https://github.com/monygroupcorp/noema/commit/7a1d3ee6925a70d32dd35ddcae999409c278fd9c))
* **ledger:** route model royalties to published-model owners at execution ([28e0c02](https://github.com/monygroupcorp/noema/commit/28e0c027b4c400755a8298db027564a2d1067673))
* **models:** import models/LoRAs by URL (Civitai/HF/direct) + license enforcement ([f70ac79](https://github.com/monygroupcorp/noema/commit/f70ac791d925bc999fb7ce158e52d0ba985985b6))
* **payouts:** gated per-payee payout book + x402 margin-split cut (ADR-0013 §4c) ([f9515c8](https://github.com/monygroupcorp/noema/commit/f9515c85a22b679d0ae68c4b6b1650760409a4db))
* **projects:** real account-owned Projects backend + holdings (Provincia) ([39658fe](https://github.com/monygroupcorp/noema/commit/39658fe5f83877fbb810ca32c54454e3fc39ebc8))
* **publishing:** BucketAdapter (R2 custody) — build-order [#2](https://github.com/monygroupcorp/noema/issues/2) ([5aece9d](https://github.com/monygroupcorp/noema/commit/5aece9d9ec76507e032ace19ba7309333ce31fb4))
* **publishing:** collection/mint — build-order [#5](https://github.com/monygroupcorp/noema/issues/5) ([a549507](https://github.com/monygroupcorp/noema/commit/a549507d1528b12b64d509b48e0d71fd79d35d4b))
* **publishing:** custody:both one-call finality (registry + bucket mirror) ([15cabb2](https://github.com/monygroupcorp/noema/commit/15cabb22b4e53bd8df8941fdc9852ebfdb352d06))
* **publishing:** durable publication worker — settle off the request path ([8c15f0d](https://github.com/monygroupcorp/noema/commit/8c15f0d5441c62a328a224123aa928f6640d3da1))
* **publishing:** Editio spine + FeedAdapter — build-order [#1](https://github.com/monygroupcorp/noema/issues/1) ([17db329](https://github.com/monygroupcorp/noema/commit/17db329be45d5a611389c704f3d4a4eca2ad288b))
* **publishing:** host trained models in our bucket (training finality, 3b) ([b7f39d2](https://github.com/monygroupcorp/noema/commit/b7f39d2a8d65ead16e93c945f490223d01c04ceb))
* **publishing:** HuggingFace LFS weight uploader (runs in the worker) ([3ff4783](https://github.com/monygroupcorp/noema/commit/3ff4783717e6e09a035f5e45eabbe7c54ea368d1))
* **publishing:** make external model upload a pluggable per-platform strategy ([a12c1e8](https://github.com/monygroupcorp/noema/commit/a12c1e8930670af1e8e0fb3f013ac91786234aa0))
* **publishing:** model publishing (HuggingFace/Civitai) — build-order [#3](https://github.com/monygroupcorp/noema/issues/3) ([7e12017](https://github.com/monygroupcorp/noema/commit/7e12017ae035c7dc4b5844655f089eecd38bdd9a))
* **publishing:** rights/license/splits — build-order [#4](https://github.com/monygroupcorp/noema/issues/4) ([afb7fb6](https://github.com/monygroupcorp/noema/commit/afb7fb64e8cdc6c06959418cce1356cad508c2b0))
* **publishing:** stream model weights to our bucket (no buffering) ([79104c1](https://github.com/monygroupcorp/noema/commit/79104c1e7037bbf832063f1530d5f8516656bf31))
* **runner-status:** ai-toolkit job → Progressus projector ([#5](https://github.com/monygroupcorp/noema/issues/5), crystal-native) ([b7ac7bf](https://github.com/monygroupcorp/noema/commit/b7ac7bf51d26f47a1f34a95ecb5305cb83c36868))
* **runner-status:** ai-toolkit training cursor — live shell ([#5](https://github.com/monygroupcorp/noema/issues/5)) ([17c8d50](https://github.com/monygroupcorp/noema/commit/17c8d50875e4120629ec61912c53caae32b8a785))
* **runner-status:** ai-toolkit training runner poll loop ([#5](https://github.com/monygroupcorp/noema/issues/5)) ([bd72db0](https://github.com/monygroupcorp/noema/commit/bd72db0b7083bf623038af334a2efba0d8c88c81))
* **runner-status:** cold-start records Progressus + pod metadata ([#6](https://github.com/monygroupcorp/noema/issues/6)a) ([dcc62ed](https://github.com/monygroupcorp/noema/commit/dcc62ed36fd9e0edcfcab158034d3ce39b6d1ece))
* **runner-status:** comfyrunner emits typed Progressus timeline ([#3](https://github.com/monygroupcorp/noema/issues/3)) ([da29878](https://github.com/monygroupcorp/noema/commit/da29878be6e871f6ae919b5c8cd61582a6ed9be7))
* **runner-status:** derive ActumExecutio durations from phaseDurations ([#6](https://github.com/monygroupcorp/noema/issues/6)d) ([1d50c95](https://github.com/monygroupcorp/noema/commit/1d50c95ae0ade2b64df9fd4ff54edd98fc81dc66))
* **runner-status:** Progressus core — owned, runner-agnostic status primitive ([17b410c](https://github.com/monygroupcorp/noema/commit/17b410c329e7e4baae0e36cd4292424e7fc1b1eb))
* **runner-status:** SSE streams owned typed Progressus ([#6](https://github.com/monygroupcorp/noema/issues/6)c) ([23b0362](https://github.com/monygroupcorp/noema/commit/23b03623727971bce900cf5ce4b2799ad48ee523))
* **runner-status:** TEE runner emits typed Progressus ([#4](https://github.com/monygroupcorp/noema/issues/4)) ([67547c3](https://github.com/monygroupcorp/noema/commit/67547c3bc16762aa16449e4b005a1d33b91b56bf))
* **runner-status:** universal status sink — /runner/status → Progressus timeline ([f8325c4](https://github.com/monygroupcorp/noema/commit/f8325c44b7f5881550248d5a2728d5a10d9b1b88))
* **runtime:** host-side ffmpeg deterministic runtime — frames-to-video (build-order [#4](https://github.com/monygroupcorp/noema/issues/4)b) ([ec54bb6](https://github.com/monygroupcorp/noema/commit/ec54bb6eb268c6eec92eb3105b52d7289d5d9c09))
* **tee:** rung-0 attestation verifier — the conformance suite that IS the spec ([10df2c6](https://github.com/monygroupcorp/noema/commit/10df2c600a993591bc6e51e8af6fc0660e723245))
* **tee:** TeePodProvisioner interface + ConfidentialPodClient (Azure NCC H100 backend) ([c07c994](https://github.com/monygroupcorp/noema/commit/c07c994d0be192f7fc5e9b1652fc51c727381cff))
* **training:** auto-caption images-only datasets on the training pod (Path A) ([2423420](https://github.com/monygroupcorp/noema/commit/2423420ba5836f7b2b38e9565a717028bcb598aa))
* **training:** backfill command — re-render published galleries on dataset captions via mycomfy ([9818550](https://github.com/monygroupcorp/noema/commit/98185504632994f63842e3bb52ba20da74db9389))
* **training:** bootstrap ai-toolkit onto a stock torch&gt;=2.9 base (drop custom image) ([43f4bc0](https://github.com/monygroupcorp/noema/commit/43f4bc0db948081f330a9aa7c6125d26147e9f17))
* **training:** completion-time finality seam on the execution webhook ([971bfaf](https://github.com/monygroupcorp/noema/commit/971bfaf270a12b74e1c176c897ed7c3be711c114))
* **training:** dataset→manifest resolver for remote training ([06b3680](https://github.com/monygroupcorp/noema/commit/06b3680694ba823a260dce2df998c54d599daa95))
* **training:** host trained LoRA in R2 + register as Intella on completion ([39ed279](https://github.com/monygroupcorp/noema/commit/39ed279d0130eb4bcff3df002cfd3b0288e6b1bb))
* **training:** krea2 model family — train preset, card facts, local trainer ([6fe9dd4](https://github.com/monygroupcorp/noema/commit/6fe9dd4396ea6e86c565232e0acd6d67a7de6bb9))
* **training:** local sample collection + retarget ms2 backlog driver to the local 4090 path ([d14c443](https://github.com/monygroupcorp/noema/commit/d14c443cb0d8769b9e29f2c97f7cba209be10515))
* **training:** make MODUS_AITOOLKIT_TRAINING duration-billed ([1208228](https://github.com/monygroupcorp/noema/commit/1208228c3e62e5e34bf35cf069482e46e5a7db4a))
* **training:** pod-side aitktrainer.py + wire contract tests ([305916b](https://github.com/monygroupcorp/noema/commit/305916b372cdd70edfe71d58893a9ebe2bd52c3b))
* **training:** publishable aitk-trainer pod image (Slice E step-5 prereq) ([b0465b6](https://github.com/monygroupcorp/noema/commit/b0465b63491fe1936d45f11c59e887fc5689a1ca))
* **training:** remote training spike harness (scripts/spike-koh-remote.ts) ([c658361](https://github.com/monygroupcorp/noema/commit/c6583613f02d2c023cfd8e22a95bb5ac320cda4a))
* **training:** RemoteAitkLauncher + detached training-pod provisioning ([d9ed974](https://github.com/monygroupcorp/noema/commit/d9ed9743dc20745bf5b07e4f48da98dcf3e83f4d))
* **training:** RemoteAitoolkitTrainingCursor (async pod dispatch) ([128586e](https://github.com/monygroupcorp/noema/commit/128586ea3d1b523863cb14d28bc08b3f745afcea))
* **training:** resumable continue-on-failure batch command for the ms2 backlog ([e8559bf](https://github.com/monygroupcorp/noema/commit/e8559bfb923b6a317210ccd7d3c9f9373b64641b))
* **training:** resumable training — proactive checkpoint rescue + resumeFrom ([390ffaa](https://github.com/monygroupcorp/noema/commit/390ffaa4f3f1dfdcaae0bb05deea4196957f7c41))
* **training:** rich HuggingFace model card + card-enrichment finality ([552b740](https://github.com/monygroupcorp/noema/commit/552b740d0c7ad61d322009693b1195a218a9ec78))
* **training:** runner-agnostic finality via urlLoraReader ([71a266f](https://github.com/monygroupcorp/noema/commit/71a266fa0e10731ccb52ec0e3928ed4285a86d65))
* **training:** sample the card gallery on dataset captions, not generic prompts ([efa4a34](https://github.com/monygroupcorp/noema/commit/efa4a34c768a2e34864a5bd0bd2adfdb2f32c103))
* **training:** samples as first-class previews + dataset/config in the published repo ([e27a5d2](https://github.com/monygroupcorp/noema/commit/e27a5d2afcad1346785b5b68adf27e0325e89716))
* **training:** seed MODUS_AITOOLKIT_TRAINING as a canon flow ([bad727a](https://github.com/monygroupcorp/noema/commit/bad727a65f2d6fe8d56f3260b4447c2f217bce17))
* **training:** slug aditus + ms2 klein backlog driver ([67c7e3a](https://github.com/monygroupcorp/noema/commit/67c7e3a92811cd2204c7bff4364ddce17de92abc))
* **training:** sweep scratch weights on completion (keep only the durable LoRA) ([b9e4178](https://github.com/monygroupcorp/noema/commit/b9e41783d7ff4c4ad90b7a05bd2095ea1fcc5840))
* **training:** the modus synthesises the ai-toolkit config from the dataset ([9dd01ba](https://github.com/monygroupcorp/noema/commit/9dd01ba5b49f961962f1ae05c178b9a04a50f8c9))
* **training:** wire RemoteAitoolkitTrainingCursor into the container ([24d72fb](https://github.com/monygroupcorp/noema/commit/24d72fbbc853c7731af4684ff331be8c13b82502))
* **training:** z-image + krea turbo workflows and family seeds ([6bf42f1](https://github.com/monygroupcorp/noema/commit/6bf42f1bb87ab5587fbdd860e88cc07696de8c7e))
* **training:** z-image model family — train preset + card facts ([f7b17e3](https://github.com/monygroupcorp/noema/commit/f7b17e34a4783b16b0eaa39ebc8ddc69f3d6edb7))
* **understanding:** seed the Qwen3-VL image→caption modus (Slice D) ([3ebd9ea](https://github.com/monygroupcorp/noema/commit/3ebd9eab3621ddc576a80adb6c6b79f54932b4df))
* **web:** adopt shared design system + project/compute surfaces ([431bd41](https://github.com/monygroupcorp/noema/commit/431bd412f2a7656c5aad78eb2ffc66b3f180a9bd))
* **web:** adopt the shared design system across every surface ([8197d8b](https://github.com/monygroupcorp/noema/commit/8197d8b6f8670319821e55520afe1492c0d42ea0))
* **web:** anonymous username+password auth rail ([4ffd99f](https://github.com/monygroupcorp/noema/commit/4ffd99f046c0d66e103665a4dfc51209d1d5d6be))
* **web:** multi-account keyring (Twitter model) ([15675d5](https://github.com/monygroupcorp/noema/commit/15675d5255a6c20a0db6b966ee07686ee5e20b05))
* **web:** Profile 'Connected accounts' panel for BYO gated-origin secrets ([dfc3b0c](https://github.com/monygroupcorp/noema/commit/dfc3b0c2fdccc095052297e584b800cb0d56f95c))
* **web:** wire fiat auth into the frontend — session layer + Door A sign-in ([00a7522](https://github.com/monygroupcorp/noema/commit/00a7522fa0dafdc21f8184b3e3baa41f173afd2d))
* **web:** wire frontend backlog Tier B [#1](https://github.com/monygroupcorp/noema/issues/1)–8 to live /v1 endpoints ([3731b08](https://github.com/monygroupcorp/noema/commit/3731b0889431e906879cd2240d0a10b53907e0c4))
* **web:** wire purse creation + admin feed-review surfaces ([53ccba1](https://github.com/monygroupcorp/noema/commit/53ccba1fa5879d12057ace3f43409c550b0a3866))
* **widget:** entrance gate + purse-funded runs (§7) ([9c2af33](https://github.com/monygroupcorp/noema/commit/9c2af335b03f4c0e114d750a7c61a4b8c1ee2ca0))
* **widget:** interactive agent runner — form → x402 pay → run → result (§7 P3) ([849e528](https://github.com/monygroupcorp/noema/commit/849e5286e374f9c78c8d909bbabe88fae602daa0))
* **widget:** NOEMA design-system skin + multi-modus picker (§7 polish) ([fe318d7](https://github.com/monygroupcorp/noema/commit/fe318d7aa6c2224496023dc62f3292c9340f2da0))
* **widget:** real collection-scoped gallery + interactive-widget scoping doc ([b11d407](https://github.com/monygroupcorp/noema/commit/b11d4079001dd5701073a52195c1c239f81ca34c))
* **widget:** real connect-wallet + owner badge, sandbox-mocked sign-in (§7) ([bf259f7](https://github.com/monygroupcorp/noema/commit/bf259f7c951d42d68d40c6cbfbd3a021498e2289))
* **widget:** StationThis embed SDK + chrome-less widget surface (ADR-0011 §6/§7) ([ad2c274](https://github.com/monygroupcorp/noema/commit/ad2c274f47508d496ea92572e88c263859ec1792))
* **x402:** stream real run Progressus phases + fix the async-run gap (§5/§7) ([be5b7cf](https://github.com/monygroupcorp/noema/commit/be5b7cf06f9b17a5c9f1ecfed313646f31bf1d42))
* **x402:** wire the real Coinbase CDP facilitator (ADR-0011 §5) ([833e456](https://github.com/monygroupcorp/noema/commit/833e4560511424797cfd44ed507844ab75c7808a))


### Bug Fixes

* **account:** integrity + crystal-core review of the settings vertical ([c5038ea](https://github.com/monygroupcorp/noema/commit/c5038ea18731b7c79ec7e1914a95ace603528695))
* **account:** wire Status + AccountSettings to the real account snapshot ([5625a61](https://github.com/monygroupcorp/noema/commit/5625a61a2abe2fa06c765ebefc39921fbac91375))
* **agent:** onboarding parity — Legatus + provisioning saga at the baked compat path (ADR-0011 phase 3) ([eb310f2](https://github.com/monygroupcorp/noema/commit/eb310f248f7dc99ef69e996f52d549e0a8fe8aaa))
* **agent:** review pass — Date-flatten bug in workspace derive + x402 double-fetch ([b04e81a](https://github.com/monygroupcorp/noema/commit/b04e81ac72d63e997e101ab66cb7e2eb32a4e10f))
* **agent:** sponsorship — Sponsio + SubsidyPolicy + subsidy sweeper (ADR-0011 phase 5) ([4692a0d](https://github.com/monygroupcorp/noema/commit/4692a0d02450ba7f186a73836f9bef2c6d129bef))
* **agent:** x402 pay-per-call capability serving + owner rev-share (ADR-0011 phase 4) ([ba389d5](https://github.com/monygroupcorp/noema/commit/ba389d591de67fe6513ef2dec1669fd42ff4b2e7))
* **auth:** federated JWKS SSO acceptor + Issuer registry (ADR-0011 phase 2) ([74810dd](https://github.com/monygroupcorp/noema/commit/74810dd15d46d2494b425430c5fb6274d358814d))
* **build:** commit untracked source/tests/docs left by parallel work ([2557728](https://github.com/monygroupcorp/noema/commit/2557728a0cd933ac8724e2dfea1320381f82bf26))
* Card screen result frame never rendered the run's output media ([6fc7869](https://github.com/monygroupcorp/noema/commit/6fc7869c237c35022790dfa7adab8e464b2ad69a))
* **ceremony,landing:** make sections flow + browser-first copy ([639907c](https://github.com/monygroupcorp/noema/commit/639907c985ede645954a7b5680023e202666c140))
* **ceremony:** drop CLI install steps — contribution is fully in-browser ([f4a3d8f](https://github.com/monygroupcorp/noema/commit/f4a3d8fc970a38de44105cf738cec54845c6346c))
* **clip_service:** install torchvision from the CPU torch index ([41299e8](https://github.com/monygroupcorp/noema/commit/41299e89966f3cefc1a869ddb4a08da7b3eacc4a))
* **collections:** review ON by default — pieces await curation before counting ([8c0a0fc](https://github.com/monygroupcorp/noema/commit/8c0a0fcb501270c22968746f977a21a70084ace0))
* **compliance:** declare onnxruntime-node optional dep for the NSFW router ([79352e1](https://github.com/monygroupcorp/noema/commit/79352e1cc70f44656db25295307d9a15784af622))
* **compliance:** HOLD verdict + reviewOutcome review-queue plumbing (A2) ([b63a62a](https://github.com/monygroupcorp/noema/commit/b63a62ade8b9cf9f1625945b6118f9168c74cfcf))
* **compliance:** moderation gate fails closed — no unscanned content on the public feed ([132d52c](https://github.com/monygroupcorp/noema/commit/132d52cde9a222345a52af4c1dc6b4c8bcbcb902))
* **contracts:** remove on-chain referral payout from CreditVault ([dd33f80](https://github.com/monygroupcorp/noema/commit/dd33f80dfab6cdeccd0c43eebf1abf123eb5ce43))
* **crystal:** add required resolution_steps to ImageScaleToTotalPixels for ComfyUI 0.26.0 ([32770be](https://github.com/monygroupcorp/noema/commit/32770be6cde169d39c5a5c02665a1f5e42266509))
* **crystal:** keep findFor in-flight-only after retain-on-settle ([6eae37b](https://github.com/monygroupcorp/noema/commit/6eae37b57a9e8c4065c8d3ab209eb24f50ec3412))
* **crystal:** klein-4b guidance via CFGGuider cfg (was 1, recipe wants 3) ([2829758](https://github.com/monygroupcorp/noema/commit/28297587e2ac5b7f8866f0013e9de711a5284478))
* **crystal:** klein-4b pairs with qwen3-4b text encoder, not qwen3-8b ([649b462](https://github.com/monygroupcorp/noema/commit/649b4620898a1dcf2ed9fd766b2415b696d90648))
* **crystal:** NOEMA branding on the HF model-card generator ([aa5c78e](https://github.com/monygroupcorp/noema/commit/aa5c78eddeebe1ee895b90e5d6edcdbf617b46c1))
* **docker:** keep internal docs out of the image; restore docs/plans gitignore convention ([2f7c192](https://github.com/monygroupcorp/noema/commit/2f7c1926eb7ad405fc7141429c73b0e58128e57e))
* **docker:** re-include the web app's imported content markdown in the image context ([21ea711](https://github.com/monygroupcorp/noema/commit/21ea711a435f6b9f75614a014ccda13f09ba3024))
* **execution:** projectExitus maps text outputs to the declared text exitus key ([716a7e5](https://github.com/monygroupcorp/noema/commit/716a7e51be00e5b5f74ccc897e87205817fac8fc))
* **flows:** canonical klein-4b txt2image flow ([f270b63](https://github.com/monygroupcorp/noema/commit/f270b6323e15ef0f31c145e7be9c270ce4bc7880))
* **import:** typed secret.required error for gated model imports (BYO F2 prereq) ([4dd5804](https://github.com/monygroupcorp/noema/commit/4dd5804e194dbb4738171ba9fdbe798353b02bcc))
* **ledger:** atomic reserve + transfer + Mongo settle parity (ADR-0011 phase 1) ([b88929b](https://github.com/monygroupcorp/noema/commit/b88929b7924f8bb704143dbeaa9b8f5785d518b5))
* **ledger:** extract transfer into one impl-agnostic helper ([783ae25](https://github.com/monygroupcorp/noema/commit/783ae25d5864f0bbccaa756014737e9129f98a1a))
* **ledger:** refresh stale hostCut test payloads (modoHostKey + baseImpetus) ([3f79121](https://github.com/monygroupcorp/noema/commit/3f791210afc8d4a1ead1ef27c72e1b1c08061b58))
* **migrate-accounts:** advance chunk window past signum-less accounts ([141e6ae](https://github.com/monygroupcorp/noema/commit/141e6ae04b208e5b53bdff6e666f1f5a291e0bb3))
* **models:** correct FLUX.2 klein license (4B-only Apache) + surface license on training receipt ([6db3cfd](https://github.com/monygroupcorp/noema/commit/6db3cfd1b708cf322941a86aefd485c84ae11ad6))
* **noema-025:** sever residual PII in tombstone; preserve co-linked animae on erase ([c123f99](https://github.com/monygroupcorp/noema/commit/c123f991ad63c8aa8c3ff2f415db1bcbe289e96e))
* **projects:** $unset cleared project fields so teamId clears to omitted ([85f421c](https://github.com/monygroupcorp/noema/commit/85f421c2033bc929acbadc254e067f7b9cd7e5fd))
* **projects:** stable project order + resolved holding names in the hub ([7c3fce9](https://github.com/monygroupcorp/noema/commit/7c3fce92c60ce78172b46a77a4a570b325518f1d))
* **publishing:** clamp /v1/feed to public surfaces; fix doc apostrophes ([9ca638b](https://github.com/monygroupcorp/noema/commit/9ca638b0b9d2ead89204a54f897db742b862c05c))
* Run page displays full generated image without crop ([1d439b4](https://github.com/monygroupcorp/noema/commit/1d439b4c50908e5b9fac2d8c300c23e392917d90))
* **runner-status:** .catch cold-start progressus records ([#6](https://github.com/monygroupcorp/noema/issues/6)a) ([71cf3f7](https://github.com/monygroupcorp/noema/commit/71cf3f7fdfcf141e719c4519cbb9ed415c61285c))
* **runner-status:** bulletin reads actum.progressus (single source) ([#6](https://github.com/monygroupcorp/noema/issues/6)b) ([ec8b0db](https://github.com/monygroupcorp/noema/commit/ec8b0dbf26633e9d0a8a6f92ba6f38513234d2de))
* **runner-status:** give the ai-toolkit training container shared memory ([#5](https://github.com/monygroupcorp/noema/issues/5)) ([3e0045d](https://github.com/monygroupcorp/noema/commit/3e0045d5cee6955fb1173cbcb41cd42317060d25))
* **runner-status:** map ai-toolkit "Generating baseline" → warming ([#5](https://github.com/monygroupcorp/noema/issues/5)) ([739e2d0](https://github.com/monygroupcorp/noema/commit/739e2d099814976b8091da747acef36c06bb92df))
* **runner-status:** tick the download n/m counter on the owned timeline ([#6](https://github.com/monygroupcorp/noema/issues/6)b) ([2f90689](https://github.com/monygroupcorp/noema/commit/2f90689718fe590f1f2f5f8f464faf341966f49f))
* **scripts:** rescue the authed close-out verifier from session scratchpad ([3b73811](https://github.com/monygroupcorp/noema/commit/3b7381145d50c467c41219552bf1e1b297e27b5a))
* **tee:** probe-kill ended race + ended-session pod guards ([71bd1f3](https://github.com/monygroupcorp/noema/commit/71bd1f36f24357c3e58428d81b3124ced202410c))
* **training:** card gallery one-lines long captions + widget preview thumbnail ([1e0fc4c](https://github.com/monygroupcorp/noema/commit/1e0fc4c1ee630c60dab5b1f4f149949053107012))
* **training:** correct aitk-trainer image-size note + smoke-test import interop ([e3d1d8a](https://github.com/monygroupcorp/noema/commit/e3d1d8a9bd81405faa5d23139d779e28f78c1ef8))
* **training:** lazy-require node:sqlite so the module imports on Node 20 ([54c7e16](https://github.com/monygroupcorp/noema/commit/54c7e168acda8412e91dd32273fa65cedba7c009))
* **training:** make root-written LoRA outputs host-readable before finality ([1d13849](https://github.com/monygroupcorp/noema/commit/1d1384973f1997678b970bf066aa9c0d76572911))
* **training:** map zimage base → ai-toolkit-krea clone in train-local ([54416f9](https://github.com/monygroupcorp/noema/commit/54416f99eb0102ff904d3e32b61d792f9cf2e5d4))
* **training:** quote instance_prompt in card + populate dataset/ on the local backlog path ([1c4a541](https://github.com/monygroupcorp/noema/commit/1c4a541d3b0002e4a6fea97f71aa6e8807274741))
* **training:** register the remote training cursor on dependency-presence, not an enable flag ([2a32e90](https://github.com/monygroupcorp/noema/commit/2a32e905cbf130e7be7c4f5ac9c1f731bb340077))
* **training:** remote bootstrap deps + run.py crash diagnostics (LIVE-VERIFIED) ([e75faeb](https://github.com/monygroupcorp/noema/commit/e75faeb930c9df24898e360a4e917c44ce8a5e0d))
* **training:** terminate the one-shot training pod on successful completion ([f275600](https://github.com/monygroupcorp/noema/commit/f27560009ad6f3b2ed8e5662483073faa35e1da4))
* **web:** Buffer polyfill + lazy-load Vault — page-breaking ReferenceError ([e3dfa90](https://github.com/monygroupcorp/noema/commit/e3dfa90fe345cad1076a9238ef077030bab1031d))
* **web:** expose project rename + delete in the hub ([c2cc05c](https://github.com/monygroupcorp/noema/commit/c2cc05ce27437b7e2cbc8871271597542dc4549e))
* **web:** feed tile lightbox + honest attribution ([264655e](https://github.com/monygroupcorp/noema/commit/264655e414104200e5356f08f1797e8c7e72102f))
* **web:** finish UX handoff 2 — flow picker, publish cross-link, Memory/TEE, retire /map ([de6d734](https://github.com/monygroupcorp/noema/commit/de6d734d2d5bca79463c37e5c796acff4ee0c8dd))
* **web:** honest 404 + collection-chain forward links ([cb88e69](https://github.com/monygroupcorp/noema/commit/cb88e69ef616df8fc9c8746df4b3b1bb76881d83))
* **web:** honest AccountSettings panes — no fabricated billing/api data ([2aee538](https://github.com/monygroupcorp/noema/commit/2aee5389c60d070d5902472cad82d07fbaa036f9))
* **web:** honest onboarding doors + name unification ([07e8963](https://github.com/monygroupcorp/noema/commit/07e8963b80b72180d9cf51b3f8ef8e1da70aacab))
* **web:** plain-language labels over schema internals ([0585d15](https://github.com/monygroupcorp/noema/commit/0585d15dc66d06e6dbf83d606d8ddaf24b6e2039))
* **web:** proactive BYO-secrets availability on /me (F3) ([812f07d](https://github.com/monygroupcorp/noema/commit/812f07d78db466b963099497c47003db914c1bf1))
* **web:** production Rail pillars + account-cluster merge (UX handoff 2) ([c79867f](https://github.com/monygroupcorp/noema/commit/c79867fd111f038950d119b8af28d272e86cfa34))
* **web:** regenerate app package-lock for circomlibjs (node 20 npm) so the image npm ci passes ([f9f875e](https://github.com/monygroupcorp/noema/commit/f9f875e9df0c602739264644c16183202f850916))
* **web:** regenerate app package-lock with npm 10 (node 20) so the image npm ci passes ([97925d4](https://github.com/monygroupcorp/noema/commit/97925d4e9f8e3a4947c3aaf9e9cf49825efc5146))
* **web:** retitle Profile, drop skins ([6c196e1](https://github.com/monygroupcorp/noema/commit/6c196e1040a9d2abf8ef94996b263608f79671fb))
* **web:** run surface tells the truth live — phases, elapsed, failure ([8ec28e4](https://github.com/monygroupcorp/noema/commit/8ec28e422748576cfe735e5b1e2cfa8c2f4c8cf9))
* **web:** skip Teams/Sponsorships list fetch when not signed in ([8402846](https://github.com/monygroupcorp/noema/commit/840284690eb49469c85c6d109c1b9ca87d79241d))
* **web:** type wallet-link response with the moved-binding flag ([3cab44d](https://github.com/monygroupcorp/noema/commit/3cab44d16a2fec1b0a885b11e7d014366dd66c01))
* **web:** UX handoff 3 (P0) — wire what's ready, honestly gate what isn't ([676ca8a](https://github.com/monygroupcorp/noema/commit/676ca8a2c2b0b769d90a0f884ee6916db4563082))
* **web:** wire Studio + private session screens to live backend; surface dormant controls ([6ef5f61](https://github.com/monygroupcorp/noema/commit/6ef5f618bdb4ac1401cf63d02e08afcaba8ffee7))


### Miscellaneous Chores

* keep release tags unprefixed (v5.0.0, not noema-v5.0.0) ([3a98433](https://github.com/monygroupcorp/noema/commit/3a984336ff8f9f61ec89624ae9d83016a304ea5a))
* pin release-please to manifest mode at 4.11.15 ([0d7bcca](https://github.com/monygroupcorp/noema/commit/0d7bccacd9feabfa11c2cda0cf69f0793d2407fa))

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
