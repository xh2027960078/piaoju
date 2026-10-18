/* 渲染调度：避免视图与 app 之间的循环依赖 */

let fn = () => {};
export function setRerender(f) { fn = f; }
export function rerender() { fn(); }
