declare module "monaco-editor/editor/editor.worker.js?worker" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module "monaco-editor/languages/definitions/python/register.js";
declare module "monaco-editor/languages/definitions/html/register.js";
declare module "monaco-editor/languages/definitions/css/register.js";
declare module "monaco-editor/editor/editor.api.js";
