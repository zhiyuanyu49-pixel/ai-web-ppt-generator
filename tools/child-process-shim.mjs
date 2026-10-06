/**
 * child_process 兼容补丁
 * ------------------------------------------------------------------
 * 背景：Windows 上 Vite 会调用 `child_process.exec('net use')` 来探测网络驱动器映射
 * （见 vite/dist/node/chunks/*.js → optimizeSafeRealPathSync）。
 * 在受限/沙箱环境中，创建子进程管道会「同步」抛出 `EPERM: spawn EPERM`，
 * 而该调用点没有 try/catch，会导致整个构建失败。
 *
 * 补丁只做一件事：当 exec/execFile 因无法创建管道而同步抛错时，
 * 改为通过回调返回错误（Vite 对该错误已有兜底：退回普通 realpath），
 * 让构建在受限环境下也能正常完成。普通环境下行为完全不变。
 */
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';

const originalExec = childProcess.exec;
const originalExecFile = childProcess.execFile;

/**
 * 构造一个最小的 ChildProcess 替身，避免调用方解引用报错。
 * @param {Error} error
 */
function fakeChild(error) {
  const emitter = new EventEmitter();
  emitter.stdout = null;
  emitter.stderr = null;
  emitter.stdin = null;
  emitter.kill = () => true;
  emitter.pid = undefined;
  process.nextTick(() => {
    // 只有在调用方真的监听了 error 时才派发，避免「Unhandled 'error' event」
    if (emitter.listenerCount('error') > 0) emitter.emit('error', error);
    emitter.emit('close', 1);
  });
  return emitter;
}

/**
 * 包装 spawn 类函数，把「同步抛出」的创建失败转成回调错误。
 * @param {Function} original
 */
function wrap(original) {
  return function wrapped(...args) {
    try {
      return original.apply(this, args);
    } catch (error) {
      const callback = args.find((arg) => typeof arg === 'function');
      if (typeof callback === 'function') {
        process.nextTick(() => callback(error, '', ''));
        return fakeChild(error);
      }
      throw error;
    }
  };
}

if (process.platform === 'win32' && !childProcess.__pipeGuardPatched) {
  childProcess.exec = wrap(originalExec);
  childProcess.execFile = wrap(originalExecFile);
  childProcess.__pipeGuardPatched = true;
}

export { childProcess };
