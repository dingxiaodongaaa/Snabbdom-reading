import {Hooks} from './hooks';
import {AttachData} from './helpers/attachto'
import {VNodeStyle} from './modules/style'
import {On} from './modules/eventlisteners'
import {Attrs} from './modules/attributes'
import {Classes} from './modules/class'
import {Props} from './modules/props'
import {Dataset} from './modules/dataset'
import {Hero} from './modules/hero'

export type Key = string | number;

export interface VNode {
  // interface 是 ts 中的语法，目的是用来约束对象都拥有这些属性

  // 选择器
  sel: string | undefined;
  // 节点数据：属性/样式/事件等，是 snabddom 中的模块所需要的数据，数据的类型是通过 VNodeData 这个接口约束的。
  data: VNodeData | undefined;
  // 子节点，和 text 属性互斥
  children: Array<VNode | string> | undefined;
  // 记录 vnode 对应的真实 DOM，当把 vnode 对象转换成 DOM 对象以后会把真实 DOM 存储在 elm 这个属性中。
  elm: Node | undefined;
  // 标签之间的内容
  text: string | undefined;
  // 优化
  key: Key | undefined;
}

export interface VNodeData {
  props?: Props;
  attrs?: Attrs;
  class?: Classes;
  style?: VNodeStyle;
  dataset?: Dataset;
  on?: On;
  hero?: Hero;
  attachData?: AttachData;
  hook?: Hooks;
  key?: Key;
  ns?: string; // for SVGs
  fn?: () => VNode; // for thunks
  args?: Array<any>; // for thunks
  [key: string]: any; // for any other 3rd party module
}

export function vnode(sel: string | undefined,
                      data: any | undefined,
                      children: Array<VNode | string> | undefined,
                      text: string | undefined,
                      elm: Element | Text | undefined): VNode {
  let key = data === undefined ? undefined : data.key;
  return {sel, data, children, text, elm, key};
}

export default vnode;
