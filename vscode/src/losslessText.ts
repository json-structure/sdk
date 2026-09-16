/**
 * VS Code's text model normalizes every line ending, even on an otherwise no-op Save.
 * Keep the authored UTF-8 source separate from that model. Offsets sent by Design are
 * source offsets, not normalized TextDocument offsets. No JSON value is reserialized.
 */
export interface SourceTextEdit { readonly range: { readonly startOffset: number; readonly endOffset: number }; readonly newText: string; }
export interface ModelTextChange { readonly rangeOffset: number; readonly rangeLength: number; readonly text: string; }
const logicalText = (text: string): string => text.replace(/\r\n|\r/g, '\n');
const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => left.length === right.length && left.every((value,index)=>value===right[index]);

export class LosslessText {
    private source: string;
    private model: string;
    private eol: string;
    private bom = false;
    private pending?: string;
    private readonly history = new Map<string,string>();
    private historyBytes = 0;

    constructor(model: string, bytes?: Uint8Array, eol = model.includes('\r\n') ? '\r\n' : '\n') {
        this.source = this.model = model;
        this.eol = eol;
        if (bytes) {
            try {
                const decoded = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
                if (logicalText(decoded) === logicalText(model)) {
                    this.source = decoded;
                    this.bom = bytes[0]===0xef && bytes[1]===0xbb && bytes[2]===0xbf;
                }
            } catch { /* An unsupported encoding remains owned by the native text model. */ }
        }
        this.remember();
    }
    get text(): string { return this.source; }
    get modeledText(): string { return this.model; }
    private normalize(text: string): string { return logicalText(text).replace(/\n/g,this.eol); }
    private bytes(text: string): Uint8Array { return new TextEncoder().encode((this.bom?'\ufeff':'')+text); }
    private remember(): void {
        const prior = this.history.get(this.model);
        if (prior !== undefined) this.historyBytes -= 2 * (this.model.length + prior.length);
        this.history.set(this.model,this.source); this.historyBytes += 2 * (this.model.length + this.source.length);
        while (this.history.size > 1 && (this.history.size > 128 || this.historyBytes > 32 * 1024 * 1024)) {
            const first = this.history.keys().next().value!; this.historyBytes -= 2 * (first.length + this.history.get(first)!.length); this.history.delete(first);
        }
    }
    sourceToModel(offset: number): number {
        if (!Number.isInteger(offset)||offset<0||offset>this.source.length) throw new Error('Source offset is outside the authored document.');
        return this.normalize(this.source.slice(0,offset)).length;
    }
    private modelToSource(offset: number): number {
        if (!Number.isInteger(offset)||offset<0||offset>this.model.length) throw new Error('Model offset is outside the normalized document.');
        let raw = 0, modeled = 0;
        while(raw<this.source.length && modeled<offset) {
            if(this.source[raw]==='\r'||this.source[raw]==='\n') { raw+=this.source[raw]==='\r'&&this.source[raw+1]==='\n'?2:1; modeled+=this.eol.length; }
            else {raw++;modeled++;}
        }
        return raw;
    }
    prepare(edits: readonly SourceTextEdit[]): readonly SourceTextEdit[] {
        const ordered=[...edits].sort((a,b)=>a.range.startOffset-b.range.startOffset || a.range.endOffset-b.range.endOffset);
        let previous=0;
        for(const edit of ordered) {if(edit.range.startOffset<previous||edit.range.endOffset<edit.range.startOffset||edit.range.endOffset>this.source.length)throw new Error('Overlapping or out-of-range source edits.');previous=edit.range.endOffset;}
        const modelEdits=edits.map(edit=>({range:{startOffset:this.sourceToModel(edit.range.startOffset),endOffset:this.sourceToModel(edit.range.endOffset)},newText:this.normalize(edit.newText)}));
        this.pending=[...ordered].reverse().reduce((text,edit)=>text.slice(0,edit.range.startOffset)+edit.newText+text.slice(edit.range.endOffset),this.source);
        return modelEdits;
    }
    cancel(): void { this.pending=undefined; }
    observe(model: string, changes: readonly ModelTextChange[] = [], eol?: string): void {
        if(this.pending!==undefined && logicalText(this.pending)===logicalText(model)) {
            this.source=this.pending;this.pending=undefined;this.model=model;if(eol)this.eol=eol;this.remember();return;
        }
        if(model===this.model) {if(eol)this.eol=eol;return;}
        const cached=this.history.get(model);
        if(cached!==undefined)this.source=cached;
        else if(changes.length) {
            const edits=changes.map(change=>({range:{startOffset:this.modelToSource(change.rangeOffset),endOffset:this.modelToSource(change.rangeOffset+change.rangeLength)},newText:change.text}));
            const next=[...edits].sort((a,b)=>b.range.startOffset-a.range.startOffset).reduce((text,edit)=>text.slice(0,edit.range.startOffset)+edit.newText+text.slice(edit.range.endOffset),this.source);
            this.source=logicalText(next)===logicalText(model)?next:model;
        } else this.source=model;
        this.model=model;if(eol)this.eol=eol;this.pending=undefined;this.remember();
    }
    /** Restore only our just-saved normalized bytes. Never replace a competing writer's content. */
    bytesToRestore(persisted: Uint8Array): Uint8Array | undefined {
        const authored=this.bytes(this.source), normalized=this.bytes(this.model);
        return !equalBytes(authored,normalized) && equalBytes(persisted,normalized) ? authored : undefined;
    }
}
