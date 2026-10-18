/* 运行环境判断 */

export const UA = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
export const isWeChat = /MicroMessenger/i.test(UA);
export const isIOS = /iPhone|iPad|iPod/i.test(UA);
export const isAndroid = /Android/i.test(UA);
export const isNativeApp = !!window.Android;

/** 微信里无法直接下载文件，给出可执行的替代路径 */
export const DOWNLOAD_HINT = '微信内不能直接保存文件：点右上角「…」→「在浏览器打开」，再导出即可；图片也可以长按保存。';
