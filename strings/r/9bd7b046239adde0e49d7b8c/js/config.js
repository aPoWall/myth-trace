export const SCENES = Object.freeze([
 {id:'atlas',name:'GLASS ATLAS',preview:'01 / GLASS',short:'glass · cold filaments',description:'Straight measured filaments and a cold glass pluck. Distant fifths dissolve into wind.',color:'#b3d7e8',visual:'Straight filaments and measuring marks',timbre:'Glass attack and near-harmonic overtones',harmony:'Spatial tail: open fifths'},
 {id:'loom',name:'HARMONIC LOOM',preview:'02 / COPPER',short:'metal · folds · breath',description:'The string opens into a copper bundle. A bright metallic pluck, warm noise attack and minor atmosphere.',color:'#d6af96',visual:'Fan of parallel filaments and folds',timbre:'Resilient metal string and breath',harmony:'Spatial tail: minor and ninth'},
 {id:'crystal',name:'CRYSTAL FIELD',preview:'03 / CRYSTAL',short:'facets · noninteger modes',description:'Crystal adds facets and angular vibration. Inharmonic overtones ring like a prism; your string notes remain.',color:'#9edbd1',visual:'Rotating facets and angular vibration',timbre:'Inharmonic modes 1 / 1.37 / 1.96 / 2.414',harmony:'Spatial tail: whole-tone shimmer'},
 {id:'orbit',name:'ORBIT SCORE',preview:'04 / GONG',short:'gong · suboctave · gravity',description:'Large rings, a slow attack and deep gong. Suboctave and low noise give a sense of mass.',color:'#aeb8e2',visual:'Gravitational ellipses and expanding rings',timbre:'Low gong, suboctave and slow attack',harmony:'Spatial tail: low fifth'},
]);
export const CONFIG = Object.freeze({
 instrument:{defaultRootMidi:57,defaultScale:'minor-pentatonic',minMidi:24,maxMidi:108,maxRegister:24,aspect:1.5,safeArea:[.08,.26,.92,.70]},
 storageKey:'constellation.score.v1',maxNodes:64,maxEdges:96,hitRadius:.035,dragThreshold:.015,noteStepMs:180,
 scale:[0,3,5,7,10],rootMidi:45,octaves:3,starCount:1300,pixelRatio:1.7,
 rhythm:{minBpm:45,maxBpm:185,stepsPerBeat:4,beatsPerBar:4,patternBars:2,lookAhead:.12,tickMs:25,startDelay:.035,lateGrace:.025,maxSwing:.38,maxVoices:24,maxFuture:.25,volume:.62,gain:.62,
 presets:[
  {id:'off',name:'Off',bpm:140,density:.56,swing:.10,pattern:{}},
  {id:'uk-half-time',name:'UK half-time',bpm:140,density:.59,swing:.15,pattern:{
   kick:[[0,.99],[6,.71],[10,.81],[16,.97],[22,.72],[27,.88],[31,.6,.76]],
   snare:[[8,.96],[24,1],[15,.29,.68],[29,.24,.8]],
   hat:[[2,.39],[4,.28,.47],[7,.36,.48],[10,.41],[11,.28,.68],[14,.52],[18,.38],[20,.28,.47],[22,.31,.55],[25,.40],[28,.35,.46],[30,.32,.7]],
   rim:[[5,.32,.66],[19,.35,.62],[30,.43,.58]]}},
  {id:'broken-club',name:'Broken club',bpm:132,density:.67,swing:.25,pattern:{
   kick:[[0,1],[3,.70],[7,.87],[10,.78],[14,.64,.56],[16,.95],[19,.72],[23,.84],[26,.79],[29,.71]],
   clap:[[4,.84],[12,.88],[20,.87],[28,.93]],
   hat:[[0,.24,.58],[2,.49],[5,.28,.48],[6,.44],[9,.29,.54],[10,.45],[13,.26,.67],[15,.47],[18,.48],[21,.32,.5],[22,.45],[25,.27,.56],[27,.42],[30,.48]],
   rim:[[6,.40,.37],[11,.40,.52],[17,.48,.41],[25,.42,.43],[31,.41,.59]]}},
  {id:'kosmodrom',name:'Kosmodrom',bpm:78,density:.53,swing:.07,pattern:{
   kick:[[0,.79],[9,.53],[16,.83],[25,.59]],
   rim:[[8,.43],[24,.42],[14,.26,.64],[30,.27,.66]],
   telemetry:[[3,.60],[12,.48],[20,.58],[29,.68],[17,.28,.63]],
   hat:[[6,.17,.34],[10,.14,.58],[14,.22,.42],[22,.17,.34],[26,.16,.51],[30,.20,.42]]}},
 ],
 drums:{
  kick:{seconds:.37,attack:.0016,release:.025,pan:0,tones:[[48,107,.020,.083,.94],[96,70,.013,.024,.14]],air:[.16,580,3400,.009],bursts:[0]},
  snare:{seconds:.24,attack:.0025,release:.030,pan:-.07,tones:[[177,27,.029,.060,.22],[326,47,.015,.033,.13]],air:[.92,720,7300,.056],bursts:[0]},
  clap:{seconds:.23,attack:.0019,release:.025,pan:.09,tones:[[251,75,.016,.041,.08]],air:[.77,780,6100,.028],bursts:[0,.012,.026]},
  hat:{seconds:.105,attack:.0015,release:.014,pan:.28,tones:[[2873,70,.024,.015,.064],[4521,110,.029,.017,.073],[6367,127,.015,.014,.052]],air:[.51,2700,10400,.020],bursts:[0]},
  rim:{seconds:.16,attack:.0018,release:.022,pan:-.22,tones:[[655,165,.017,.026,.38],[1247,82,.012,.022,.25],[2208,119,.018,.012,.13]],air:[.26,1500,5600,.014],bursts:[0]},
  telemetry:{seconds:.43,attack:.0045,release:.042,pan:.42,tones:[[429,124,.024,.092,.37],[678,-100,.080,.115,.19],[1291,-44,.044,.056,.053]],air:[.23,480,1720,.057],bursts:[0,.09]},
 }},
 samples:{maxVoices:8,maxTriggerSeconds:8,maxDecodedSeconds:60,maxBytes:10485760,maxEntries:3,maxChannels:2,minRate:.5,maxRate:2,sliceCount:8,peakCount:128,attack:.006,release:.026,volume:.60,gain:.72},
 strings:{contactMotionMin:.0015,touchRadius:.018,releaseRadius:.035,endpointMargin:.065,cooldownMs:170,minLength:.06,maxLength:1.8,referenceLength:.55,referenceMidi:57,minMidi:33,maxMidi:88,damping:2.2,maxEnergy:1,maxDisplacement:.027,visualHz:9,maxSweep:.7,minVelocity:.18,maxVelocity:1.2},
 tracking:{precision:{width:1280,height:720,frameRate:30,maxHands:2,minDetection:.5,minPresence:.5,minTracking:.5,smoothing:{minCutoff:2.4,beta:18,dCutoff:1.5},identity:{predictionMs:100,distanceScale:1.45,mismatchPenalty:.04,sizePenalty:.18},minPalmPixels:34,orientationEdgeRatio:.10,stallMs:100,pinchDistanceScale:1.35,minWorldPalm:.018,obliqueRatio:.58},maxHands:4,minHandScore:.35,eraseHoldMs:350,fps:30,pinchOn:.72,pinchOff:.42,lostMs:340,debounceMs:100,spreadThreshold:.62,spreadCooldownMs:2400},
 audio:{voiceAmount:.5,chordSpread:.15,ambience:{maxVoices:4,space:.45,probeSeconds:11,tail:9.2,fade:.75,tailFloor:.012,airFloorHz:45,airCeilingRatio:.38,airPan:.24,scenes:{
 atlas:{seconds:6.6,attack:.67,noise:[2900,1250,.74,.25],tones:[[1.5,.225,-.79,.08,.74],[3,.14,.74,.29,.57],[2.002,.087,.44,.18,.63],[4.49,.062,-.48,.42,.41]]},
 loom:{seconds:7.3,attack:.79,noise:[670,305,.97,.30],tones:[[.5,.197,-.79,.05,.96],[1.189207,.245,.67,.19,.72],[1.498307,.103,-.37,.25,.77],[2.244924,.085,.53,.34,.61]]},
 crystal:{seconds:7.9,attack:.54,noise:[3850,1900,1.22,.27],tones:[[1.122462,.177,-.86,.08,.68],[1.259921,.196,.85,.24,.76],[1.414214,.158,-.58,.36,.69],[1.781797,.102,.46,.51,.46]]},
 orbit:{seconds:9.2,attack:1.05,noise:[340,115,.86,.35],tones:[[.5,.31,-.68,.06,.98],[.75,.26,.72,.26,.94],[.998,.12,-.48,.49,.76],[.501,.152,.79,.31,.90]]}}},
 stringScenes:{
 atlas:{partials:[[1,.96,1,1],[1.5,.29,.82,1],[2,.34,.66,2],[3,.23,.48,3],[4.04,.14,.35,4],[6.12,.085,.25,5]],stiffness:.20,attackScale:.51,decayScale:1.12,gain:.93,noise:.12,noiseHz:4900,noiseQ:1.2,noiseDecay:.047,bendCents:0,space:[[.092,.16,-.75],[.167,.12,.73]]},
 crystal:{partials:[[1,.82,.94,1],[1.37,.37,.75,2],[1.96,.35,.69,3],[2.414,.32,.56,4],[2.916,.20,.48,5],[4.31,.14,.36,6],[6.08,.079,.25,7]],stiffness:.12,attackScale:.80,decayScale:1.35,gain:.9,noise:.18,noiseHz:4200,noiseQ:1.7,noiseDecay:.057,bendCents:0,space:[[.102,.17,-.83],[.228,.12,.8]]},
 orbit:{partials:[[1,.74,.96,1],[.5,.93,1,1],[.75,.31,.9,1],[1.57,.23,.67,2],[2.19,.17,.49,3],[3.26,.095,.37,4],[4.6,.061,.25,5]],stiffness:.25,attackScale:2.3,decayScale:1.85,gain:1.08,noise:.21,noiseHz:480,noiseQ:.8,noiseDecay:.128,bendCents:5,space:[[.151,.16,-.6],[.289,.12,.65]]}},
 stringStiffness:.00085,stringSlackStiffness:.00315,stringTensionBrighten:.85,stringTouchMin:.055,stringTouchBoost:2.15,stringModeFloor:.001,stringNoiseBrighten:.72,stringProbeSeconds:4.15,noteGain:.30,minimumGain:.00008,meterSize:1024,volumeRamp:.018,renderPreroll:.025,noiseSeconds:.16,noiseAttack:.003,panWidth:.68,saturatorSize:4097,bendTime:.045,voiceBreath:.55,voiceBrighten:1.6,nyquistMargin:.91,maxProbeSeconds:12,
 scenes:{
 metal:{partials:[[1,1,1],[2,.55,.82],[3,.40,.68],[4,.29,.58],[5,.225,.51],[6,.174,.45],[7,.138,.40],[8,.105,.36],[9,.081,.31],[10,.064,.28],[11,.049,.25],[12,.039,.22]],attackScale:.37,decayScale:1.32,gain:.87,noise:.23,noiseHz:3150,noiseQ:.82,noiseDecay:.046,bendCents:0,space:[[.065,.13,-.6],[.131,.08,.62]]},
 atlas:{partials:[[1,1,.95],[2,.34,.58],[3.01,.20,.38],[4.02,.11,.26],[5.05,.063,.21]],attackScale:.75,decayScale:1,gain:1,noise:.13,noiseHz:1350,noiseQ:.72,noiseDecay:.074,bendCents:2,space:[[.083,.16,-.66],[.142,.09,.61]]},
 loom:{partials:[[1,1,.94],[2.003,.54,.72],[3.012,.39,.52],[4.028,.24,.38],[5.05,.15,.29],[7.09,.075,.19]],attackScale:.56,decayScale:.93,gain:.86,noise:.23,noiseHz:1170,noiseQ:1.3,noiseDecay:.082,bendCents:7,space:[[.054,.14,.48],[.111,.09,-.57]]},
 crystal:{partials:[[1,.8,.77],[2,.43,.95],[3.002,.25,.72],[4.17,.24,.49],[5.41,.17,.39],[7.03,.12,.27]],attackScale:1.15,decayScale:1.29,gain:.82,noise:.10,noiseHz:3450,noiseQ:1.65,noiseDecay:.053,bendCents:0,space:[[.118,.15,-.78],[.219,.11,.80]]},
 orbit:{partials:[[.5,1,1],[1,.40,.94],[1.502,.18,.59],[2.013,.23,.74],[2.714,.11,.46],[4.09,.07,.25]],attackScale:2.6,decayScale:1.9,gain:1.06,noise:.11,noiseHz:530,noiseQ:1.07,noiseDecay:.13,bendCents:5,space:[[.147,.17,-.52],[.282,.12,.60]]}},
 volume:.48,maxVoices:16,attack:.009,decay:1.8,release:.12,tail:3.8,sampleRate:48000,limit:.82},
 visual:{grain:.032,portraitMix:.72,skyGain:.8,filamentGain:.7,handLinger:340},
});
