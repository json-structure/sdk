import { rangeFor } from './parser.js';
import { schemaRecord, schemaValueAt } from './schema-locations.js';
import type { CommandContext, CommandResult, EditorCommand } from './commands.js';
/** Explicit Source editing is the escape hatch for malformed/legacy schemas. Only the selected token changes. */
export class ReplaceSchemaSourceCommand implements EditorCommand {
  constructor(readonly pointer: string, readonly source: string) {}
  canExecute({session,documentVersion}: CommandContext): boolean {
    if (session.snapshot().documentVersion !== documentVersion || session.snapshot().recovery !== 'valid') return false;
    if (!session.model?.nodes.some(n=>n.pointer===this.pointer && n.range)) return false;
    try { JSON.parse(this.source); return true; } catch { return false; }
  }
  execute(context: CommandContext): CommandResult {
    if (!this.canExecute(context)) throw new Error('Source must be one complete JSON value at an unambiguous source location.');
    const range = context.session.model!.nodes.find(n=>n.pointer===this.pointer)!.range!;
    const source = context.session.snapshot().text.slice(range.startOffset,range.endOffset);
    return { edits:[{range,newText:this.source}], inverseEdits:[{range:{...range,endOffset:(range.startOffset ?? 0)+this.source.length},newText:source}] };
  }
}

/** Changes only the collection's type and ownership key; the member schema and all siblings keep their bytes. */
export class ChangeCollectionKindCommand implements EditorCommand {
  constructor(readonly pointer: string, readonly kind: 'array'|'set'|'map') {}
  canExecute({session,documentVersion}: CommandContext): boolean {
    const value=schemaValueAt(session.value,this.pointer);
    if(documentVersion!==session.snapshot().documentVersion||session.snapshot().recovery!=='valid'||!schemaRecord(value)||!['array','set','map'].includes(String(value.type)))return false;
    const from=value.type==='map'?'values':'items',to=this.kind==='map'?'values':'items';
    return !!session.model?.nodes.find(n=>n.pointer===this.pointer+'/type')?.range && (from===to || Object.hasOwn(value,from)&&!Object.hasOwn(value,to)&&!!session.model?.nodes.find(n=>n.pointer===this.pointer+'/'+from)?.keyRange);
  }
  execute(context: CommandContext): CommandResult {
    if(!this.canExecute(context))throw new Error('Collection kind cannot change without a source-addressable member schema, or the destination items/values member is already authored. No source was changed.');
    const {session}=context,value=schemaValueAt(session.value,this.pointer) as Record<string,unknown>;
    const from=value.type==='map'?'values':'items',to=this.kind==='map'?'values':'items';
    const typeRange=session.model!.nodes.find(n=>n.pointer===this.pointer+'/type')!.range!;
    const edits=[{range:typeRange,newText:JSON.stringify(this.kind)}];
    if(from!==to)edits.push({range:session.model!.nodes.find(n=>n.pointer===this.pointer+'/'+from)!.keyRange!,newText:JSON.stringify(to)});
    const source=session.snapshot().text;
    const sorted=[...edits].sort((a,b)=>(a.range.startOffset??0)-(b.range.startOffset??0));
    const next=[...sorted].reverse().reduce((text,edit)=>text.slice(0,edit.range.startOffset)+edit.newText+text.slice(edit.range.endOffset),source);
    let delta=0;const inverseEdits=sorted.map(edit=>{const start=edit.range.startOffset!+delta;delta+=edit.newText.length-(edit.range.endOffset!-edit.range.startOffset!);return {range:rangeFor(next,start,start+edit.newText.length),newText:source.slice(edit.range.startOffset,edit.range.endOffset)};});
    return {edits,inverseEdits,pointerTransforms:from===to?[]:[{from:this.pointer+'/'+from,to:this.pointer+'/'+to}]};
  }
}
