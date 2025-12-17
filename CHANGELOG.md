# [1.5.0](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.4.0...v1.5.0) (2025-12-17)


### Bug Fixes

* jsdocs of slots ([21c487b](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/21c487bca907881d26fd563e62d7622d6fbe0445))


### Features

* add event binding support with hover, go-to-definition and type checking ([c33eb3a](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/c33eb3a13c81c88bada2ee52a5a236445e59f792))

# [1.4.0](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.3.1...v1.4.0) (2025-12-15)


### Features

* **events:** improve CustomEvent hover info with detail type inference ([8b3cceb](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/8b3cceb4100d3efa5bb93be493ed6909680aed3b))

## [1.3.1](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.3.0...v1.3.1) (2025-12-12)


### Bug Fixes

* improve property detection in HTML templates ([3029b1f](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/3029b1f5f79dd3672e22dc7f9ddfea1a5238945a))

# [1.3.0](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.2.0...v1.3.0) (2025-12-10)


### Bug Fixes

* standardize CLI output format (file:line:col: level: message) ([132d110](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/132d110ec636604fd9f07712afe88088e926d298))


### Features

* add quick info (hover) for properties, attributes, events and tags ([1d82b3e](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/1d82b3e95514148670a2ac4a0073c6ae9a217b65))

# [1.2.0](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.1.0...v1.2.0) (2025-12-10)


### Bug Fixes

* resolve go-to-definition to actual file for dynamic imports ([b9e8a0c](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/b9e8a0c9f1e90a454f0dcfe0c1af55869788957f))


### Features

* add go-to-definition for CustomEvent listeners ([@event](https://github.com/event)) ([930c4ee](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/930c4eebb5cc351211a8f0ed2d90926e3dfd5edb))
* add go-to-definition for properties and attributes in templates ([1007d4c](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/1007d4c64ada51db8e4ef027c52c811788d0e70f))

# [1.1.0](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.0.6...v1.1.0) (2025-12-09)


### Bug Fixes

* case-insensitive attribute matching for boolean properties ([40722d1](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/40722d16adde74a4a441e0786f7f0e0e634a318e))
* normalize file paths for Windows compatibility ([47ab72f](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/47ab72fd5d9e033e61833c3c70444e6ff531ae9d))


### Features

* add go-to-definition for scoped elements in templates ([401a112](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/401a112e48d956714cfc501e48d2ab9dabd04b95))
* add go-to-definition for scoped elements in templates ([746673d](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/746673dcb5d1f7a3b4a8395b6bcfae18969bfdca))
* add ignoreFiles option to exclude files by regex patterns ([7e7a8c9](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/7e7a8c9ca5c0fa8fc4fff09ebba8986048908288))
* support dynamic this.registry.define() for scoped elements ([894ba9f](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/894ba9f88595191420cd18a9635db45ebd286652))

## [1.0.6](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.0.5...v1.0.6) (2025-12-08)


### Bug Fixes

* add some logs to debug windows ([6add86f](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/6add86f07140ac2906b5a8bddfd951dda49a0025))

## [1.0.5](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.0.4...v1.0.5) (2025-12-08)


### Bug Fixes

* try to debug diag on window ([a358605](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/a358605c39d240644cd44a60150276b19cbe1f08))

## [1.0.4](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.0.3...v1.0.4) (2025-10-08)


### Bug Fixes

* handle ?: as undefined ([5a4c2c9](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/5a4c2c9e4c23967721134f72e96ef11234f9be9c))

## [1.0.3](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.0.2...v1.0.3) (2025-10-07)


### Bug Fixes

* better handling attributes ([dd98171](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/dd98171442462fbe1b374579a5837f593d7f2270))

## [1.0.2](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.0.1...v1.0.2) (2025-10-07)


### Bug Fixes

* revert last commit ([c599522](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/c599522762a298c74b38d32eb89da7f78e7ffe4c))
* use NODE_AUTH_TOKEN instead of NPM_TOKEN ([bd8bdb2](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/bd8bdb203c97ed683d37b4dc6d02cdc35bb2634c))

## [1.0.1](https://github.com/intescia-group/ts-plugin-lit-binding-checker/compare/v1.0.0...v1.0.1) (2025-10-07)


### Bug Fixes

* disable private repo ([cf0d37a](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/cf0d37a2893f5082a7e0d4995e43f1aecc62f876))

# 1.0.0 (2025-10-07)


### Features

* init project ([e330f03](https://github.com/intescia-group/ts-plugin-lit-binding-checker/commit/e330f03ded537154b74000b661b2488a1203b720))
