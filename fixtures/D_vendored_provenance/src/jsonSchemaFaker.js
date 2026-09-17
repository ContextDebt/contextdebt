/*
 * Json-schema-faker is causing big HMR and Webpack headaches when @novu/framework is used in Next.js.
 * To address the issue, we decided to go old-school and hardcode the IIFE version of the source code in our package.
 *
 * The code was copied for https://unpkg.com/browse/json-schema-faker@0.5.6/dist/main.iife.js.
 */
class Schema {
  static get customTags() {
    // TODO: remove in v2
    return schemas;
  }
  static get deprecatedCustomTags() {
    // TODO: remove in v2
    return schemas;
  }
}
export default Schema;
