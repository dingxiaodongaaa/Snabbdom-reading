/* global module, document, Node */
// 导入 Module 接口，定义钩子函数的形式
import {Module} from './modules/module';
import {Hooks} from './hooks';
import vnode, {VNode, VNodeData, Key} from './vnode';
import * as is from './is';
import htmlDomApi, {DOMAPI} from './htmldomapi';

function isUndef(s: any): boolean { return s === undefined; }
function isDef(s: any): boolean { return s !== undefined; }

type VNodeQueue = Array<VNode>;

const emptyNode = vnode('', {}, [], undefined, undefined);

function sameVnode(vnode1: VNode, vnode2: VNode): boolean {
  return vnode1.key === vnode2.key && vnode1.sel === vnode2.sel;
}

function isVnode(vnode: any): vnode is VNode {
  return vnode.sel !== undefined;
}

type KeyToIndexMap = {[key: string]: number};

type ArraysOf<T> = {
  [K in keyof T]: (T[K])[];
}

type ModuleHooks = ArraysOf<Module>;

function createKeyToOldIdx(children: Array<VNode>, beginIdx: number, endIdx: number): KeyToIndexMap {
  let i: number, map: KeyToIndexMap = {}, key: Key | undefined, ch;
  for (i = beginIdx; i <= endIdx; ++i) {
    ch = children[i];
    if (ch != null) {
      key = ch.key;
      if (key !== undefined) map[key] = i;
    }
  }
  return map;
}

const hooks: (keyof Module)[] = ['create', 'update', 'remove', 'destroy', 'pre', 'post'];

export {h} from './h';
export {thunk} from './thunk';

export function init(modules: Array<Partial<Module>>, domApi?: DOMAPI) {
  let i: number, j: number, cbs = ({} as ModuleHooks);
  // 初始化转换虚拟节点的 api
  const api: DOMAPI = domApi !== undefined ? domApi : htmlDomApi;
  // 把传入的所有模块的钩子函数统一存储到 cbs 对象中
  // 最终创建的 cbs 对象的形式 cbs = { create: [fn1, fn2], update: [], ... }
  for (i = 0; i < hooks.length; ++i) {
    // cbs.create = [], cbs.update = []...
    cbs[hooks[i]] = [];
    for (j = 0; j < modules.length; ++j) {
      const hook = modules[j][hooks[i]];
      if (hook !== undefined) {
        // 把获取到的 hook 函数放到 cbs 对应的钩子函数数组中，将来在 patch 函数调用的时候会在合适的时机调用这些函数。
        (cbs[hooks[i]] as Array<any>).push(hook);
      }
    }
  }

  function emptyNodeAt(elm: Element) {
    const id = elm.id ? '#' + elm.id : '';
    const c = elm.className ? '.' + elm.className.split(' ').join('.') : '';
    return vnode(api.tagName(elm).toLowerCase() + id + c, {}, [], undefined, elm);
  }

  function createRmCb(childElm: Node, listeners: number) {
    return function rmCb() {
      if (--listeners === 0) {
        const parent = api.parentNode(childElm);
        api.removeChild(parent, childElm);
      }
    };
  }

  function createElm(vnode: VNode, insertedVnodeQueue: VNodeQueue): Node {
    let i: any, data = vnode.data;
    if (data !== undefined) {
      // 执行用户设置的 init 钩子函数
      if (isDef(i = data.hook) && isDef(i = i.init)) {
        i(vnode);
        // 这里再次给 data 更新的原因是，init 钩子函数是用户设置的，所以可能会再这个钩子函数中去改变 data 中的数据
        data = vnode.data;
      }
    }
    // 把 vnode 转换成真实 DOM 对象（没有渲染到页面）
    let children = vnode.children, sel = vnode.sel;
    if (sel === '!') {
      // 如果是感叹号就去创建注释节点
      if (isUndef(vnode.text)) {
        // 如果为 undefined ，赋值为空字符串，为了后续调用 api.createComment
        vnode.text = '';
      }
      // 创建注释节点
      vnode.elm = api.createComment(vnode.text as string);
    } else if (sel !== undefined) {
      // 如果 sel 选择器不为空
      // 解析选择器
      // 创建对应的 DOM 元素
      // Parse selector
      const hashIdx = sel.indexOf('#');
      const dotIdx = sel.indexOf('.', hashIdx);
      const hash = hashIdx > 0 ? hashIdx : sel.length;
      const dot = dotIdx > 0 ? dotIdx : sel.length;
      const tag = hashIdx !== -1 || dotIdx !== -1 ? sel.slice(0, Math.min(hash, dot)) : sel;
      // data.ns 是命名空间（namespace）的意思，判断是否要创建一个带有命名空间的标签，一般情况下是 svg
      const elm = vnode.elm = isDef(data) && isDef(i = (data as VNodeData).ns) ? api.createElementNS(i, tag)
                                                                               : api.createElement(tag);
      if (hash < dot) elm.setAttribute('id', sel.slice(hash + 1, dot));
      if (dotIdx > 0) elm.setAttribute('class', sel.slice(dot + 1).replace(/\./g, ' '));
      // 执行模块中的 create 钩子函数
      for (i = 0; i < cbs.create.length; ++i) cbs.create[i](emptyNode, vnode);
      // 如果 vnode 中有子节点，创建子 vnode 对应的 DOM 元素并追加到 DOM 树上
      if (is.array(children)) {
        for (i = 0; i < children.length; ++i) {
          const ch = children[i];
          if (ch != null) {
            api.appendChild(elm, createElm(ch as VNode, insertedVnodeQueue));
          }
        }
      } else if (is.primitive(vnode.text)) {
        api.appendChild(elm, api.createTextNode(vnode.text));
      }
      i = (vnode.data as VNodeData).hook; // Reuse variable
      if (isDef(i)) {
        // 执行用户传入的钩子 create
        if (i.create) i.create(emptyNode, vnode);
        // 如果有 insert 钩子函数，就将 vnode 添加到队列中，为后续执行 insert 钩子做准备
        if (i.insert) insertedVnodeQueue.push(vnode);
      }
    } else {
      // 如果选择器为空，创建文本节点
      vnode.elm = api.createTextNode(vnode.text as string);
    }
    // 返回新创建的 DOM
    return vnode.elm;
  }

  function addVnodes(parentElm: Node,
                     before: Node | null,
                     vnodes: Array<VNode>,
                     startIdx: number,
                     endIdx: number,
                     insertedVnodeQueue: VNodeQueue) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx];
      if (ch != null) {
        api.insertBefore(parentElm, createElm(ch, insertedVnodeQueue), before);
      }
    }
  }

  function invokeDestroyHook(vnode: VNode) {
    let i: any, j: number, data = vnode.data;
    if (data !== undefined) {
      // 执行用户设置的 destroy 钩子函数
      if (isDef(i = data.hook) && isDef(i = i.destroy)) i(vnode);
      // 调用模块的 destroy 钩子函数
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode);
      // 执行子节点的 destroy 钩子函数
      if (vnode.children !== undefined) {
        for (j = 0; j < vnode.children.length; ++j) {
          i = vnode.children[j];
          if (i != null && typeof i !== "string") {
            invokeDestroyHook(i);
          }
        }
      }
    }
  }

  function removeVnodes(parentElm: Node,
                        vnodes: Array<VNode>,
                        startIdx: number,
                        endIdx: number): void {
    // 循环数组中从 startIndex 到 endIndex 的所有 vnode
    for (; startIdx <= endIdx; ++startIdx) {
      let i: any, listeners: number, rm: () => void, ch = vnodes[startIdx];
      if (ch != null) {
        // 如果 sel 有值，元素节点
        if (isDef(ch.sel)) {
          // 执行 destroy 钩子函数（会执行所有子节点的 destroy 钩子函数）
          invokeDestroyHook(ch);
          // 记录模块中 remove 钩子函数的个数，为了防止重复的去调用删除节点的方法
          listeners = cbs.remove.length + 1;
          // 高阶函数，创建删除的回调函数
          rm = createRmCb(ch.elm as Node, listeners);
          for (i = 0; i < cbs.remove.length; ++i) cbs.remove[i](ch, rm);
          // 判断用户是否设置了 remove 钩子函数，如果有则执行
          if (isDef(i = ch.data) && isDef(i = i.hook) && isDef(i = i.remove)) {
            i(ch, rm);
          } else {
            // 如果用户没有创建 remove 钩子函数，就直接调用删除元素的方法
            rm();
          }
        } else { // Text node
          // 如果是文本节点，直接调用删除元素的方法
          api.removeChild(parentElm, ch.elm as Node);
        }
      }
    }
  }

  function updateChildren(parentElm: Node,
                          oldCh: Array<VNode>,
                          newCh: Array<VNode>,
                          insertedVnodeQueue: VNodeQueue) {
    let oldStartIdx = 0, newStartIdx = 0;
    let oldEndIdx = oldCh.length - 1;
    let oldStartVnode = oldCh[0];
    let oldEndVnode = oldCh[oldEndIdx];
    let newEndIdx = newCh.length - 1;
    let newStartVnode = newCh[0];
    let newEndVnode = newCh[newEndIdx];
    let oldKeyToIdx: any;
    let idxInOld: number;
    let elmToMove: VNode;
    let before: any;
    
    // 循环对比新界节点数组种的元素
    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      // 索引变化后，可能会把节点设置为空
      if (oldStartVnode == null) {
        // 节点为空，移动索引
        oldStartVnode = oldCh[++oldStartIdx]; // Vnode might have been moved left
      } else if (oldEndVnode == null) {
        oldEndVnode = oldCh[--oldEndIdx];
      } else if (newStartVnode == null) {
        newStartVnode = newCh[++newStartIdx];
      } else if (newEndVnode == null) {
        newEndVnode = newCh[--newEndIdx];
      // 比较开始和结束节点的四种情况
      } else if (sameVnode(oldStartVnode, newStartVnode)) {
        // 1. 比较老开始节点和新开始节点，然后更新 DOM
        patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue);
        // 移动索引指向下一个节点
        oldStartVnode = oldCh[++oldStartIdx];
        newStartVnode = newCh[++newStartIdx];
      } else if (sameVnode(oldEndVnode, newEndVnode)) {
        // 2. 比较老结束节点和新结束节点，然后更新 DOM
        patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue);
        // 更新索引
        oldEndVnode = oldCh[--oldEndIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldStartVnode, newEndVnode)) { // Vnode moved right
        // 3. 比较老开始节点和新结束节点，然后更新 DOM
        patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue);
        api.insertBefore(parentElm, oldStartVnode.elm as Node, api.nextSibling(oldEndVnode.elm as Node));
        // 更新索引
        oldStartVnode = oldCh[++oldStartIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldEndVnode, newStartVnode)) { // Vnode moved left
        // 4. 比较老结束节点和新开始节点
        patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue);
        api.insertBefore(parentElm, oldEndVnode.elm as Node, oldStartVnode.elm as Node);
        oldEndVnode = oldCh[--oldEndIdx];
        newStartVnode = newCh[++newStartIdx];
      } else {
        // 开始节点和结束节点都不相同
        // 使用 newStartNode 的 key 在老节点数组中找相同节点
        if (oldKeyToIdx === undefined) {
          // 先设置记录 key 和 index 的对象
          oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx);
        }
        // 遍历 newStartVnode ，从老节点中找相同 key 的 oldVnode 的索引
        idxInOld = oldKeyToIdx[newStartVnode.key as string];
        // 如果是新的 Node
        if (isUndef(idxInOld)) { // New element
          // 如果没找到，newStartNode 是新节点
          // 创建元素插入 DOM 树
          api.insertBefore(parentElm, createElm(newStartVnode, insertedVnodeQueue), oldStartVnode.elm as Node);
          // 重新给 newStartVnode 赋值，指向下一个新节点
          newStartVnode = newCh[++newStartIdx];
        } else {
          // 如果找到 key 相同的老节点，记录到 elemToMove 遍历
          elmToMove = oldCh[idxInOld];
          // 比较老节点的 sel 属性是否和新的开始节点的 sel 属性相同
          if (elmToMove.sel !== newStartVnode.sel) {
            // 如果新旧节点的选择器不同
            // 创建新开始节点对应的 DOM 元素，插入到 DOM 树中
            api.insertBefore(parentElm, createElm(newStartVnode, insertedVnodeQueue), oldStartVnode.elm as Node);
          } else {
            // 如果相同，patchVnode()
            // 把 elmToMove 对应的 DOM 元素，移到左边
            patchVnode(elmToMove, newStartVnode, insertedVnodeQueue);
            oldCh[idxInOld] = undefined as any;
            api.insertBefore(parentElm, (elmToMove.elm as Node), oldStartVnode.elm as Node);
          }
          // 重新给 newStartVnode 赋值，指向下一个节点
          newStartVnode = newCh[++newStartIdx];
        }
      }
    }
    // 循环结束，老节点数组先遍历完成或者新节点数组先遍历完成
    if (oldStartIdx <= oldEndIdx || newStartIdx <= newEndIdx) {
      if (oldStartIdx > oldEndIdx) {
        // 如果老节点数组先遍历完成，说明新的节点剩余
        // 把剩余的节点都插入到右边
        before = newCh[newEndIdx+1] == null ? null : newCh[newEndIdx+1].elm;
        addVnodes(parentElm, before, newCh, newStartIdx, newEndIdx, insertedVnodeQueue);
      } else {
        // 如果新节点数组先遍历完成，说明老节点数组有剩余
        // 把剩余老节点删除
        removeVnodes(parentElm, oldCh, oldStartIdx, oldEndIdx);
      }
    }
  }

  function patchVnode(oldVnode: VNode, vnode: VNode, insertedVnodeQueue: VNodeQueue) {
    // 第一步：先执行两个钩子函数
    let i: any, hook: any;
    // 首先判断用户是否设置了 prepatch 钩子函数，如果有，执行
    if (isDef(i = vnode.data) && isDef(hook = i.hook) && isDef(i = hook.prepatch)) {
      i(oldVnode, vnode);
    }
    // 获取 oldValue 的 DOM 元素，并赋值给新节点的属性 elm
    const elm = vnode.elm = (oldVnode.elm as Node);
    // 获取新老节点中的子节点
    let oldCh = oldVnode.children;
    let ch = vnode.children;
    // 判断新老节点的地址是否是相同的，如果相同说明节点没有发生变化，直接返回
    if (oldVnode === vnode) return;
    if (vnode.data !== undefined) {
      // 执行模块的 update 钩子函数
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode);
      i = vnode.data.hook;
      // 执行用户设置的 update 钩子函数
      if (isDef(i) && isDef(i = i.update)) i(oldVnode, vnode);
    }
    // 第二步：对比两个 vnode
    // 如果 vnode.text 未定义
    if (isUndef(vnode.text)) {
      // 如果新老节点都有 children 
      if (isDef(oldCh) && isDef(ch)) {
        // 如果新老节点的 children 不相同，使用 diff 算法对比子节点，更新子节点
        if (oldCh !== ch) updateChildren(elm, oldCh as Array<VNode>, ch as Array<VNode>, insertedVnodeQueue);
      } else if (isDef(ch)) {
        // 如果只有新节点有 children
        // 判断老节点中是否有文本内容，如果有，清空
        if (isDef(oldVnode.text)) api.setTextContent(elm, '');
        // 通过 addVnodes 把新节点中增加的子节点添加到页面上
        addVnodes(elm, null, ch as Array<VNode>, 0, (ch as Array<VNode>).length - 1, insertedVnodeQueue);
      } else if (isDef(oldCh)) {
        // 如果只有老节点有 children
        // 删除老节点的子节点
        removeVnodes(elm, oldCh as Array<VNode>, 0, (oldCh as Array<VNode>).length - 1);
      } else if (isDef(oldVnode.text)) {
        // 如果老节点有 text ，清空 DOM 元素
        api.setTextContent(elm, '');
      }
    } else if (oldVnode.text !== vnode.text) {
      // vnode.text 发生了变化
      if (isDef(oldCh)) {
        // 如果老节点中有 children ，移除
        removeVnodes(elm, oldCh as Array<VNode>, 0, (oldCh as Array<VNode>).length - 1);
      }
      // 设置 DOM 元素的 textContent 为 vnode.text
      api.setTextContent(elm, vnode.text as string);
    }
    // 第三步：最后执行用户设置的 postpatch 钩子函数
    if (isDef(hook) && isDef(i = hook.postpatch)) {
      i(oldVnode, vnode);
    }
  }

  // init 内部返回 patch 函数，把 vnode 渲染成真实 dom ，并返回vnode
  // 高阶函数，返回一个函数
  // 可以把调用内部函数是需要传递的所有的共同参数提取出来，在调用外部函数的时候，
  // 将共同参数传入，使程序形成闭包，当我们在之后调用内部函数的时候，就只需要传递动态的参数。
  // 而且，这样的形式可以保证共同参数在内存中只保存一份
  return function patch(oldVnode: VNode | Element, vnode: VNode): VNode {
    let i: number, elm: Node, parent: Node;
    // 保存新插入节点的队列，为了触发钩子函数
    const insertedVnodeQueue: VNodeQueue = [];
    // 执行模块的 pre 钩子函数，pre 使处理虚拟节点执行的第一个钩子函数
    for (i = 0; i < cbs.pre.length; ++i) cbs.pre[i]();

    // 如果 oldVnode 不是 VNode ，创建 VNode 并设置 elm
    if (!isVnode(oldVnode)) {
      // 把 DOM 元素转换成空的 VNode
      oldVnode = emptyNodeAt(oldVnode);
    }
    // 如果新旧节点是相同节点（key 和 sel 相同）
    if (sameVnode(oldVnode, vnode)) {
      // 对比节点的差异并且更新到 DOM 上
      patchVnode(oldVnode, vnode, insertedVnodeQueue);
    } else {
      // 如果新旧节点不同，vnode 创建对应的 DOM 
      // 获取当前的 DOM 元素
      elm = oldVnode.elm as Node;
      parent = api.parentNode(elm);
      // 创建 vnode 对应的 DOM 元素，并触发 init/create 钩子函数。
      createElm(vnode, insertedVnodeQueue);

      if (parent !== null) {
        // 如果父节点不为空，把 vnode 对应的 dom 插入到文档中
        api.insertBefore(parent, vnode.elm as Node, api.nextSibling(elm));
        // 移除老节点
        removeVnodes(parent, [oldVnode], 0, 0);
      }
    }
    // 执行用户设置的 insert 钩子函数
    for (i = 0; i < insertedVnodeQueue.length; ++i) {
      (((insertedVnodeQueue[i].data as VNodeData).hook as Hooks).insert as any)(insertedVnodeQueue[i]);
    }
    // 执行模块的 post 钩子函数
    for (i = 0; i < cbs.post.length; ++i) cbs.post[i]();
    // 返回 vnode 作为下一次操作的 oldVnode 处理
    return vnode;
  };
}
