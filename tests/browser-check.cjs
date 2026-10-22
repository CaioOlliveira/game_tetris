// Optional Windows integration check using the installed Edge and native Node WebSocket.
const {spawn}=require('node:child_process');
const {mkdtempSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
(async()=>{
  const port=19348,profile=mkdtempSync(join(tmpdir(),'tetris-edge-'));
  const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let ws;
  try{
    let targets;
    for(let i=0;i<80;i++){try{targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();if(targets.length)break;}catch{}await new Promise(r=>setTimeout(r,150));}
    assert(targets?.length,'Edge debugging unavailable');
    ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});
    let id=0;const pending=new Map(),errors=[];
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
    const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
    const evaluate=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
    await call('Runtime.enable');await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:pathToFileURL(resolve('dist/index.html')).href});
    for(let i=0;i<60;i++){if(await evaluate('document.readyState === "complete" && !!document.getElementById("start")'))break;await new Promise(r=>setTimeout(r,150));}
    assert(await evaluate('!!document.getElementById("display").getContext("2d")'));
    assert.equal(await evaluate('document.getElementById("display").width'),240);
    await call('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(join(tmpdir(),'tetris-desktop.png'),Buffer.from(r.data,'base64')));
    await evaluate('document.getElementById("start").click()');
    assert(await evaluate('document.getElementById("overlay").classList.contains("hidden")'));
    await call('Input.dispatchKeyEvent',{type:'keyDown',code:'Space',key:' '});await call('Input.dispatchKeyEvent',{type:'keyUp',code:'Space',key:' '});
    await evaluate('document.getElementById("pause").click()');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('document.getElementById("restart").click()');
    const sizes=await evaluate('({body:document.body.scrollWidth,viewport:innerWidth,ratio:document.getElementById("display").getBoundingClientRect().width/document.getElementById("display").getBoundingClientRect().height})');
    assert(sizes.body<=sizes.viewport);assert(Math.abs(sizes.ratio-.75)<.01);
    await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}).then(r=>writeFileSync(join(tmpdir(),'tetris-mobile.png'),Buffer.from(r.data,'base64')));
    assert.deepEqual(errors,[]);console.log('Browser checks passed: menu, start, keyboard, pause, restart, 240x320 canvas, responsive width, 3:4 aspect, no runtime exceptions. Screenshots in TEMP.');
    await call('Browser.close');
  }finally{ws?.close();edge.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
