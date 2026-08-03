/**
 * Where Recall is.
 *
 * Hard-coded, and matching `ApiDataSource`'s hard-coded workspace. A
 * configurable port would need `optional_host_permissions` and a grant flow,
 * because `host_permissions` in the manifest is static — a runtime setting that
 * silently could not be honoured is worse than no setting. If you move the
 * port, change it here and in `manifest.json`; that is two lines and it is
 * honest.
 */
export const ENDPOINT_ORIGIN = 'http://127.0.0.1:5170';
export const WORKSPACE = 'ws_demo';
export const CAPTURE_URL = `${ENDPOINT_ORIGIN}/api/workspaces/${WORKSPACE}/capture`;
