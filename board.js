/* Shared viewer and per-item selection; no model inference or video modification. */
(() => {
  "use strict";
  const config=JSON.parse(document.getElementById("board-data").textContent);
  const all=config.rows, byId=new Map(all.map(r=>[r.uid,r])), $=id=>document.getElementById(id);
  const storageKey="h3-sixty-selection-v1";
  const selectedPage=config.view==="selected", snapshot=config.view==="snapshot";
  let state={revision:0,items:{}}, dirty={},visible=[],current=null,serverOK=false,pending=0,fetchedRevision=null;
  let queue=Promise.resolve(),noteTimer=null,noteUid=null,filterTimer=null;
  const escText=(el,text)=>{el.textContent=text??"";};
  function status(text,error=false){escText($("status"),text);$("status").className=error?"error":"";}
  function marked(uid){return !!state.items[uid]?.marked;}
  function cached(){try{return JSON.parse(localStorage.getItem(storageKey)||"null");}catch{return null;}}
  function cache(){try{localStorage.setItem(storageKey,JSON.stringify({...state,pendingChanges:dirty}));}catch{/* File save remains authoritative. */}}
  function mergeLocal(raw,fromServer=false){
    if(!raw||typeof raw!=="object"||!raw.items||typeof raw.items!=="object")return;
    state={revision:Number(raw.revision)||0,items:{}};
    for(const [uid,v] of Object.entries(raw.items))if(byId.has(uid)&&v&&typeof v==="object")
      state.items[uid]={marked:!!v.marked,note:typeof v.note==="string"?v.note.slice(0,4000):""};
    if(!fromServer&&raw.pendingChanges&&typeof raw.pendingChanges==="object"){
      for(const [uid,v] of Object.entries(raw.pendingChanges))if(byId.has(uid)&&v&&typeof v==="object"){
        const patch={};if(typeof v.marked==="boolean")patch.marked=v.marked;
        if(typeof v.note==="string")patch.note=v.note.slice(0,4000);
        if(Object.keys(patch).length)dirty[uid]=patch;
      }
    }
    for(const [uid,patch] of Object.entries(dirty))state.items[uid]={marked:false,note:"",...state.items[uid],...patch};
  }
  async function pull(){
    if(snapshot||pending||noteTimer)return;
    try{
      const res=await fetch("api/marks",{cache:"no-store"});if(!res.ok)throw Error("服务暂不可用");
      const data=await res.json(),changed=fetchedRevision!==Number(data.revision)||!serverOK||Object.keys(dirty).length;
      serverOK=true;
      if(changed){mergeLocal(data,true);fetchedRevision=Number(data.revision);cache();renderGrid();reconcile();}
      const retry=Object.entries(dirty);
      if(retry.length){status("正在恢复并同步未保存的浏览器标记…");for(const [uid,patch] of retry)enqueue(uid,{...patch});}
      else status("标记与备注自动保存到本机文件。");
    }catch{
      serverOK=false;status("当前仅保存在本浏览器。请导出标记备份，或恢复本机标记服务。",true);
    }
  }
  function enqueue(uid,patch){
    if(snapshot)return Promise.resolve();
    dirty[uid]={...dirty[uid],...patch};
    state.items[uid]={marked:false,note:"",...(state.items[uid]||{}),...patch};cache();
    pending++;status("正在保存…");
    const action=async()=>{
      try{
        const res=await fetch("api/marks",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},
          body:JSON.stringify({id:uid,...patch})});
        if(!res.ok)throw Error("保存失败");
        const result=await res.json();state.revision=result.revision;serverOK=true;
        for(const [key,value] of Object.entries(patch))if(dirty[uid]?.[key]===value)delete dirty[uid][key];
        if(dirty[uid]&&!Object.keys(dirty[uid]).length)delete dirty[uid];cache();
      }catch{serverOK=false;}
      finally{
        pending--;
        if(!pending){const saved=serverOK&&!Object.keys(dirty).length;status(saved?"已保存到本机文件。":"尚未写入本机文件，已保留浏览器副本；请导出标记备份。",!saved);}
      }
    };
    queue=queue.then(action,action);return queue;
  }
  function flushNote(){
    if(!noteTimer)return;
    clearTimeout(noteTimer);noteTimer=null;
    if(noteUid)enqueue(noteUid,{note:state.items[noteUid]?.note||""});
    noteUid=null;
  }
  function chosenRows(){
    const batch=$("batch").value,filter=$("filter").value,q=$("search").value.trim().toLowerCase();
    return all.filter(r=>(batch==="all"||r.batch===batch)&&
      (!(selectedPage||filter==="marked")||marked(r.uid))&&
      (filter!=="unmarked"||!marked(r.uid))&&
      (!q||[r.uid,r.title,r.input,state.items[r.uid]?.note].join(" ").toLowerCase().includes(q)));
  }
  function markControl(uid){
    const label=document.createElement("label");label.className="marklabel";
    const input=document.createElement("input");input.type="checkbox";input.checked=marked(uid);input.disabled=snapshot;
    input.setAttribute("aria-label","标记 "+uid);
    input.addEventListener("change",()=>setMarked(uid,input.checked));
    const text=document.createElement("span");text.textContent=snapshot?"已选入":"标记";
    label.append(input,text);return label;
  }
  function setMarked(uid,value){
    flushNote();enqueue(uid,{marked:value});
    const was=current,previous=visible.findIndex(r=>r.uid===uid);
    renderGrid();
    if(was===uid&&!visible.some(r=>r.uid===uid)){
      if(visible.length)open(visible[Math.min(Math.max(previous,0),visible.length-1)].uid);
      else close();
    }else if(current===uid)$("detail-mark").checked=value;
  }
  function reconcile(){
    if(current&&!visible.some(r=>r.uid===current)){
      if(visible.length)open(visible[0].uid);else close();
    }
  }
  function renderGrid(){
    visible=chosenRows();const grid=$("grid");grid.replaceChildren();
    const count=all.filter(r=>marked(r.uid)).length;
    $("marked-count").textContent="已标记 "+count+" / "+all.length;
    $("visible-count").textContent="当前 "+visible.length+" 组";
    $("empty").hidden=!!visible.length;
    $("empty").textContent=(selectedPage||$("filter").value==="marked")?"还没有符合条件的标记。到总看板勾选后，这里会自动显示。":"没有符合筛选条件的项目。";
    for(const r of visible){
      const card=document.createElement("article");card.className="card"+(marked(r.uid)?" marked":"");card.dataset.uid=r.uid;
      const image=document.createElement("img");image.src=r.source;image.alt=r.uid+" "+r.title;image.loading="lazy";image.className="thumb";
      image.addEventListener("click",()=>open(r.uid));image.tabIndex=0;image.setAttribute("role","button");
      image.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open(r.uid);}});
      const body=document.createElement("div");body.className="cardbody";
      const title=document.createElement("h2");title.textContent=r.uid+" · "+r.title;
      const meta=document.createElement("p");meta.textContent=r.batchLabel+" · "+r.duration.toFixed(2)+"秒 · 生成"+r.generation_seconds.toFixed(1)+"秒";
      const note=document.createElement("p");note.className="smallnote";note.textContent=state.items[r.uid]?.note||"";
      const bar=document.createElement("div");bar.className="cardbar";
      const play=document.createElement("button");play.textContent="查看视频";play.addEventListener("click",()=>open(r.uid));
      bar.append(markControl(r.uid),play);body.append(title,meta,note,bar);card.append(image,body);grid.append(card);
    }
    if(current){
      $("detail-mark").checked=marked(current);
      const p=visible.findIndex(r=>r.uid===current);$("position").textContent=p>=0?(p+1)+" / "+visible.length:"当前项目已被筛选隐藏";
      if(document.activeElement!==$("note"))$("note").value=state.items[current]?.note||"";
    }
  }
  function showMedia(kind){
    if(!current)return;
    const r=byId.get(current),video=$("video"),image=$("image");
    video.pause();video.hidden=kind!=="video";image.hidden=kind==="video";
    if(kind!=="video")image.src=kind==="firstframe"?r.firstframe:r.source;
    for(const type of ["video","source","firstframe"])$("media-"+type).classList.toggle("active",type===kind);
    $("media-caption").textContent=kind==="video"?"最终原片 · 原速":"source"===kind?"原始输入图片":"实际送入H3的生成首帧";
  }
  function open(uid){
    if(!byId.has(uid))return;
    flushNote();current=uid;const r=byId.get(uid);
    $("modal").hidden=false;document.body.classList.add("lockscroll");
    $("detail-title").textContent=r.uid+" · "+r.title;
    $("video").src=r.video;$("video").load();showMedia("video");
    $("media-firstframe").hidden=!r.firstframe;
    $("meta").textContent=r.batchLabel+"　时长 "+r.duration.toFixed(2)+"秒　完整生成时间 "+r.generation_seconds.toFixed(1)+"秒";
    for(const [id,key] of [["input","input"],["expansion","expansion"],["h3","h3_prompt"],["conclusion","conclusion"],["optimization","optimization"]])escText($(id),r[key]);
    $("verdict").textContent="助手初评："+r.verdict;
    $("detail-mark").checked=marked(uid);$("detail-mark").disabled=snapshot;
    $("note").value=state.items[uid]?.note||"";$("note").readOnly=snapshot;
    const p=visible.findIndex(x=>x.uid===uid);$("position").textContent=(p+1)+" / "+visible.length;
    location.hash=uid;
  }
  function close(){flushNote();$("video").pause();$("modal").hidden=true;document.body.classList.remove("lockscroll");current=null;history.replaceState(null,"",location.pathname+location.search);}
  function move(delta){
    if(!visible.length)return close();
    const i=visible.findIndex(r=>r.uid===current);open(visible[(Math.max(0,i)+delta+visible.length)%visible.length].uid);
  }
  function download(name,data,type="application/json"){
    const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $("export").onclick=()=>{flushNote();download("H3_60组标记.json",JSON.stringify({version:1,revision:state.revision,
    items:state.items,selected:all.filter(r=>marked(r.uid)).map(r=>({id:r.uid,title:r.title,note:state.items[r.uid]?.note||""}))},null,2));};
  $("import").onclick=()=>$("import-file").click();
  $("import-file").onchange=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const obj=JSON.parse(await file.text()),entries=[];
      if(!obj.items||typeof obj.items!=="object")throw Error("文件缺少标记信息");
      for(const [uid,v] of Object.entries(obj.items))if(byId.has(uid)&&v&&typeof v==="object"){
        if(typeof v.marked!=="boolean"||typeof v.note!=="string")throw Error("标记字段不完整");
        entries.push([uid,{marked:v.marked,note:v.note.slice(0,4000)}]);
      }
      if(!entries.length)throw Error("没有匹配这60组的标记");
      flushNote();for(const [uid,value] of entries)enqueue(uid,value);
      renderGrid();await queue;
    }catch(error){status("导入失败："+error.message,true);}finally{e.target.value="";}
  };
  $("snapshot").onclick=async()=>{
    flushNote();await queue;
    if(Object.keys(dirty).length){await pull();await queue;}
    if(Object.keys(dirty).length){status("仍有标记未同步到本机文件，暂不能生成固定看板；请先恢复服务或导出备份。",true);return;}
    if(!all.some(r=>marked(r.uid))){status("请先标记至少一组。",true);return;}
    try{
      const res=await fetch("api/snapshot",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      if(!res.ok)throw Error(await res.text());
      const result=await res.json();$("snapshot-link").href=result.url;$("snapshot-link").hidden=false;
      status("已生成独立固定看板，共 "+result.count+" 组。点击“打开固定看板”查看。");
    }catch{status("生成固定看板失败；现有标记已保留，可以先查看实时已标记看板或导出备份。",true);}
  };
  $("detail-mark").onchange=()=>current&&setMarked(current,$("detail-mark").checked);
  $("note").addEventListener("input",()=>{
    if(!current||snapshot)return;
    const uid=current;state.items[uid]={marked:false,...state.items[uid],note:$("note").value.slice(0,4000)};cache();
    dirty[uid]={...dirty[uid],note:state.items[uid].note};cache();
    if(noteTimer)clearTimeout(noteTimer);noteUid=uid;
    noteTimer=setTimeout(()=>{noteTimer=null;noteUid=null;enqueue(uid,{note:state.items[uid]?.note||""});renderGrid();},450);
  });
  $("close").onclick=close;$("prev").onclick=()=>move(-1);$("next").onclick=()=>move(1);
  for(const kind of ["video","source","firstframe"])$("media-"+kind).onclick=()=>showMedia(kind);
  $("wide").onclick=()=>{$("modal").classList.toggle("wide");$("wide").textContent=$("modal").classList.contains("wide")?"恢复布局":"放大视频";};
  $("batch").onchange=()=>{close();history.replaceState(null,"",location.pathname+($("batch").value==="all"?"":"?batch="+$("batch").value));renderGrid();};$("filter").onchange=()=>{close();renderGrid();};
  $("search").oninput=()=>{clearTimeout(filterTimer);filterTimer=setTimeout(renderGrid,150);};
  document.addEventListener("keydown",e=>{
    if($("modal").hidden)return;
    if(e.key==="Escape"){close();return;}
    if(["INPUT","TEXTAREA","SELECT","VIDEO"].includes(document.activeElement.tagName))return;
    if(e.key==="ArrowLeft")move(-1);if(e.key==="ArrowRight")move(1);
  });
  window.addEventListener("focus",pull);window.addEventListener("storage",e=>{if(!snapshot&&e.key===storageKey&&!pending&&!noteTimer){mergeLocal(cached());renderGrid();reconcile();}});
  window.addEventListener("beforeunload",()=>{
    if(snapshot)return;
    if(noteTimer){clearTimeout(noteTimer);noteTimer=null;noteUid=null;}
    cache();
    for(const [uid,patch] of Object.entries(dirty))try{
      fetch("api/marks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:uid,...patch}),keepalive:true});
    }catch{}
  });
  async function init(){
    if(snapshot){mergeLocal(config.snapshotMarks);$("selection-actions").hidden=true;status("公开只读看板 · 60段原片已随网页保存，无需连接本机。");}
    else{mergeLocal(cached());await pull();}
    if(selectedPage){$("filter").value="marked";$("filter").disabled=true;}
    const match=location.search.match(/[?&]batch=([AB])(?:&|$)/);if(match)$("batch").value=match[1];
    renderGrid();if(location.hash&&byId.has(location.hash.slice(1)))open(location.hash.slice(1));
    if(!snapshot)setInterval(pull,4000);
  }
  init();
})();
