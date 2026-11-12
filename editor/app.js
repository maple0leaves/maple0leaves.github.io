const $ = id => document.getElementById(id);
const fields = { title: $('title'), category: $('category'), tags: $('tags'), content: $('content') };
let currentId = null;
let dirty = false;
let posts = [];
let previewTimer;
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Maple-Editor': '1', ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败');
  return data;
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3500);
}

function setDirty(value) {
  dirty = value;
  $('saveState').textContent = value ? '尚未保存' : currentId ? '已保存' : '准备写作';
  $('documentName').textContent = fields.title.value.trim() || '新文章';
}

function collect() {
  return {
    title: fields.title.value.trim(), category: fields.category.value.trim(),
    tags: fields.tags.value.split(/[,，]/).map(x => x.trim()).filter(Boolean),
    content: fields.content.value,
  };
}

function fill(post) {
  currentId = post?.id || null;
  fields.title.value = post?.title || '';
  fields.category.value = post?.category || '';
  fields.tags.value = (post?.tags || []).join(', ');
  fields.content.value = post?.content || '';
  setDirty(false);
  renderList();
  updatePreview();
}

function renderList() {
  $('postCount').textContent = posts.length;
  const list = $('postList');
  list.replaceChildren();
  for (const post of posts) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `post-item${post.id === currentId ? ' active' : ''}`;
    const name = document.createElement('strong');
    name.textContent = post.title;
    const date = document.createElement('small');
    date.textContent = `${String(post.date).slice(0, 10)}${post.category ? ' · ' + post.category : ''}`;
    button.append(name, date);
    button.addEventListener('click', () => openPost(post.id));
    list.append(button);
  }
}

async function refreshList() {
  posts = (await api('/api/posts')).posts;
  renderList();
}

function confirmDiscard() {
  return !dirty || window.confirm('当前修改还没有保存。要放弃这些修改吗？');
}

async function openPost(id) {
  if (id === currentId || !confirmDiscard()) return;
  try {
    const { post } = await api(`/api/posts/${encodeURIComponent(id)}`);
    fill(post);
    fields.title.focus();
  } catch (error) { toast(error.message); }
}

function newPost() {
  if (!confirmDiscard()) return;
  fill(null);
  fields.title.focus();
}

async function save() {
  const data = collect();
  if (!data.title) { fields.title.focus(); throw new Error('请先填写文章标题'); }
  $('saveButton').disabled = true;
  try {
    const { post } = await api(currentId ? `/api/posts/${encodeURIComponent(currentId)}` : '/api/posts', {
      method: currentId ? 'PUT' : 'POST', body: JSON.stringify(data),
    });
    currentId = post.id;
    setDirty(false);
    await refreshList();
    toast('草稿已保存到电脑');
    return post;
  } finally { $('saveButton').disabled = false; }
}

const previewStyle = `<style>body{margin:0;padding:24px 26px;color:#34453b;background:#fffefa;font:14px/1.9 "Microsoft YaHei",sans-serif;overflow-wrap:anywhere}h1,h2,h3{font-family:Georgia,"Noto Serif SC",serif;line-height:1.45;color:#26352e}h2{font-size:23px;margin-top:1.7em}h3{font-size:18px}p{margin:0 0 1.3em}a{color:#ad6041}img{max-width:100%;height:auto}blockquote{border-left:2px solid #ad6041;padding-left:18px;margin-left:0;color:#77847b}pre{background:#26352e;color:white;padding:15px;overflow:auto;border-radius:4px}code{font:12px Consolas,monospace}ul,ol{padding-left:24px}</style>`;

async function updatePreview() {
  const content = fields.content.value;
  try {
    const { html } = await api('/api/preview', { method: 'POST', body: JSON.stringify({ content }) });
    $('preview').srcdoc = `<!doctype html><html><head><meta charset="utf-8">${previewStyle}</head><body>${html || '<p style="color:#aeb9af">正文预览会显示在这里。</p>'}</body></html>`;
  } catch { $('preview').srcdoc = '<p>预览暂时不可用</p>'; }
}

function insertText(before, after = '', fallback = '文字') {
  const input = fields.content;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const selection = input.value.slice(start, end) || fallback;
  input.setRangeText(before + selection + after, start, end, 'select');
  input.focus();
  setDirty(true);
  schedulePreview();
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 250);
}

async function insertImage(file) {
  if (!file) return;
  if (file.size > 8_000_000) return toast('图片请小于 8 MB');
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const { url } = await api('/api/images', { method: 'POST', body: JSON.stringify({ mime: file.type, data: String(dataUrl).split(',')[1] }) });
    const input = fields.content;
    const position = input.selectionStart;
    input.setRangeText(`\n![${file.name.replace(/\]/g, '')}](${url})\n`, position, position, 'end');
    setDirty(true);
    updatePreview();
    toast('图片已插入正文');
  } catch (error) { toast(error.message); }
  $('imageInput').value = '';
}

async function publishSite() {
  if ($('publishButton').disabled) return;
  $('publishButton').disabled = true;
  try {
    if (dirty || !currentId) await save();
    await api('/api/publish', { method: 'POST', body: '{}' });
    $('publishTitle').textContent = '正在发布网站';
    $('publishMessage').textContent = '正在生成网页、上传到 GitHub，并备份文章原稿。';
    $('publishLog').textContent = '';
    $('visitSite').hidden = true;
    $('closeDialog').disabled = true;
    $('publishDialog').showModal();
    let status;
    do {
      await new Promise(resolve => setTimeout(resolve, 1200));
      status = (await api('/api/publish')).publish;
      $('publishLog').textContent = status.log.slice(-3500);
      $('publishLog').scrollTop = $('publishLog').scrollHeight;
    } while (status.running);
    if (status.state === 'success') {
      $('publishTitle').textContent = '发布完成';
      $('publishMessage').textContent = '文章已上传。GitHub Pages 通常还需要一点时间更新公开页面。';
      $('visitSite').hidden = false;
      toast('网站已发布');
    } else {
      $('publishTitle').textContent = '发布遇到问题';
      $('publishMessage').textContent = '文章已保存在电脑。请查看下方提示；如需帮助，可以把提示发给我。';
    }
    $('closeDialog').disabled = false;
  } catch (error) { toast(error.message); } finally { $('publishButton').disabled = false; }
}

$('newPost').addEventListener('click', newPost);
$('saveButton').addEventListener('click', () => save().catch(error => toast(error.message)));
$('publishButton').addEventListener('click', publishSite);
$('closeDialog').addEventListener('click', () => $('publishDialog').close());
$('imageButton').addEventListener('click', () => $('imageInput').click());
$('imageInput').addEventListener('change', event => insertImage(event.target.files[0]));
document.querySelectorAll('[data-insert]').forEach(button => button.addEventListener('click', () => {
  const kind = button.dataset.insert;
  if (kind === 'heading') insertText('\n## ', '', '小标题');
  if (kind === 'bold') insertText('**', '**');
  if (kind === 'list') insertText('\n- ', '', '列表项目');
  if (kind === 'link') insertText('[', '](https://example.com)', '链接文字');
}));
Object.values(fields).forEach(field => field.addEventListener('input', () => { setDirty(true); if (field === fields.content) schedulePreview(); }));
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
refreshList().then(() => fill(null)).catch(error => toast(`无法读取文章：${error.message}`));
