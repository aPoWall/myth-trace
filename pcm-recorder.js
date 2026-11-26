/* Four-channel, bounded PCM capture. Never emits input audio to its output.
 * The host supplies/replenishes transferable blocks; process() allocates no buffers.
 * Layout per frame: dry mono, wet mono, mixed left, mixed right.
 */
class BlackframePCMRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options.processorOptions || {};
    this.blockFrames = config.blockFrames || 8192;
    this.maxFrames = Math.floor(sampleRate * Math.min(180, config.maxSeconds || 180));
    this.pool = []; this.block = null; this.used = 0; this.total = 0; this.active = false; this.finished = false;
    this.chunkMessage = {type:'chunk', buffer:null, frames:0}; this.transferList = [null];
    this.port.onmessage = ({data}) => {
      if(data.type === 'buffer') this.pool.push(new Float32Array(data.buffer));
      else if(data.type === 'start' && !this.finished) this.active = true;
      else if(data.type === 'stop') this.finish('stop');
    };
  }
  flush() {
    if(!this.block || !this.used)return;
    this.chunkMessage.buffer = this.block.buffer; this.chunkMessage.frames = this.used; this.transferList[0] = this.block.buffer;
    this.port.postMessage(this.chunkMessage, this.transferList); this.block = null; this.used = 0;
  }
  finish(reason) {
    if(this.finished)return; this.active=false; this.finished=true; this.flush();
    this.port.postMessage({type:'finished',frames:this.total,reason});
  }
  process(inputs, outputs) {
    if(outputs[0]?.[0])outputs[0][0].fill(0);
    if(!this.active)return true;
    const input=inputs[0],frames=input?.[0]?.length || 128;
    for(let frame=0;frame<frames;frame++) {
      if(!this.block) {
        this.block=this.pool.pop();
        if(!this.block){this.finish('overflow');break;}
      }
      const offset=this.used*4;
      this.block[offset]=input?.[0]?.[frame] || 0;
      this.block[offset+1]=input?.[1]?.[frame] || 0;
      this.block[offset+2]=input?.[2]?.[frame] || 0;
      this.block[offset+3]=input?.[3]?.[frame] || 0;
      this.used++;this.total++;
      if(this.used===this.blockFrames)this.flush();
      if(this.total>=this.maxFrames){this.finish('limit');break;}
    }
    return true;
  }
}
registerProcessor('blackframe-pcm-recorder', BlackframePCMRecorder);
