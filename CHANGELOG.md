# Changelog

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
