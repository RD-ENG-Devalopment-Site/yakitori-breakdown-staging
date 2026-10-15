document.addEventListener('DOMContentLoaded', () => {
  const badge = document.createElement('div');
  badge.setAttribute('role', 'status');
  badge.textContent = "STAGING · Google Login เปิด · การบันทึกยังปิดอยู่";
  Object.assign(badge.style, {position:'fixed',right:'12px',bottom:'12px',zIndex:'2147483647',
    padding:'8px 12px',border:'1px solid #ffd34b',borderRadius:'10px',
    background:'#171925',color:'#ffe27b',font:'600 12px/1.4 system-ui,sans-serif',
    boxShadow:'0 5px 18px #0008',pointerEvents:'none'});
  document.body.append(badge);
});
