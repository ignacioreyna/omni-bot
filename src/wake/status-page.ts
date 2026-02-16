import type { OmniBotStatus } from './process-manager.js';

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderStatusPage(status: OmniBotStatus): string {
  const isRunning = status.running;
  const uptimeStr = status.uptime ? formatUptime(status.uptime) : '-';
  const statusColor = isRunning ? '#3fb950' : '#f85149';
  const statusText = isRunning ? 'Running' : 'Stopped';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Omni-Bot</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;display:flex;justify-content:center;align-items:center;min-height:100vh}
    .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:2rem;max-width:400px;width:90%;text-align:center}
    h1{font-size:1.4rem;margin-bottom:1.5rem;color:#f0f6fc}
    .status{font-size:1.1rem;margin-bottom:1rem;display:flex;align-items:center;justify-content:center;gap:.5rem}
    .dot{width:10px;height:10px;border-radius:50%;display:inline-block}
    .meta{font-size:.85rem;color:#8b949e;margin-bottom:1.5rem}
    .meta div{margin-bottom:.25rem}
    .actions{display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap}
    button{padding:.6rem 1.5rem;border-radius:6px;border:1px solid #30363d;font-size:.9rem;cursor:pointer;font-weight:500;transition:all .15s}
    button:disabled{opacity:.5;cursor:not-allowed}
    .btn-start{background:#238636;color:#fff;border-color:#2ea043}
    .btn-start:hover:not(:disabled){background:#2ea043}
    .btn-stop{background:#da3633;color:#fff;border-color:#f85149}
    .btn-stop:hover:not(:disabled){background:#f85149}
    .btn-restart{background:#1f6feb;color:#fff;border-color:#388bfd}
    .btn-restart:hover:not(:disabled){background:#388bfd}
    .msg{font-size:.85rem;margin-top:1rem;min-height:1.2rem}
    .msg.error{color:#f85149}
    .msg.info{color:#58a6ff}
    .spinner{display:none;margin:1rem auto}
    .spinner.active{display:block}
    @keyframes spin{to{transform:rotate(360deg)}}
    .spinner::after{content:'';display:block;width:20px;height:20px;margin:0 auto;border:2px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:spin .7s linear infinite}
  </style>
</head>
<body>
  <div class="card">
    <h1>Omni-Bot</h1>
    <div class="status">
      <span class="dot" id="dot" style="background:${statusColor}"></span>
      <span id="status-text">${statusText}</span>
    </div>
    <div class="meta">
      <div>PID: <span id="pid">${status.pid ?? '-'}</span></div>
      <div>Uptime: <span id="uptime">${uptimeStr}</span></div>
      <div>Restarts: <span id="restarts">${status.restarts}</span></div>
    </div>
    <div class="actions">
      <button class="btn-start" id="btn-start" onclick="action('start')" ${isRunning ? 'disabled' : ''}>Start</button>
      <button class="btn-stop" id="btn-stop" onclick="action('stop')" ${!isRunning ? 'disabled' : ''}>Stop</button>
      <button class="btn-restart" id="btn-restart" onclick="action('restart')">Restart</button>
    </div>
    <div class="spinner" id="spinner"></div>
    <div class="msg" id="msg">${status.lastError ? '<span class="error">Last error: ' + escapeHtml(status.lastError) + '</span>' : ''}</div>
  </div>
  <script>
    async function action(name){
      const spinner=document.getElementById('spinner');
      const msg=document.getElementById('msg');
      spinner.classList.add('active');
      msg.innerHTML='';
      document.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{
        const res=await fetch('/wake/'+name,{method:'POST'});
        const data=await res.json();
        if(!res.ok)throw new Error(data.error||'Failed');
        if(name==='start'||name==='restart'){
          msg.innerHTML='<span class="info">Redirecting...</span>';
          setTimeout(()=>{window.location.href='/';},1500);
        }else{
          window.location.reload();
        }
      }catch(err){
        msg.innerHTML='<span class="error">'+err.message+'</span>';
        document.querySelectorAll('button').forEach(b=>b.disabled=false);
      }finally{
        spinner.classList.remove('active');
      }
    }
    setInterval(async()=>{
      try{
        const res=await fetch('/wake/status');
        const d=await res.json();
        document.getElementById('status-text').textContent=d.running?'Running':'Stopped';
        document.getElementById('dot').style.background=d.running?'#3fb950':'#f85149';
        document.getElementById('pid').textContent=d.pid||'-';
        document.getElementById('uptime').textContent=d.uptime?fmtUp(d.uptime):'-';
        document.getElementById('restarts').textContent=d.restarts;
        document.getElementById('btn-start').disabled=d.running;
        document.getElementById('btn-stop').disabled=!d.running;
      }catch{}
    },5000);
    function fmtUp(ms){
      const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60);
      if(h>0)return h+'h '+(m%60)+'m';
      if(m>0)return m+'m '+(s%60)+'s';
      return s+'s';
    }
  </script>
</body>
</html>`;
}
