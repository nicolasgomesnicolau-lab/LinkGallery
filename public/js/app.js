var currentView = 'folders'
var currentPhotos = []
var currentFavorites = []
var favSet = new Set()
var allFolders = []
var slideIndex = 0
var slideInterval = null
var isPlaying = true
var zoomLevel = 1
var panX = 0, panY = 0
var pinchStartDist = 0
var slideTime = 3
var networkUrl = ''
var gridSize = 1
var sizeLabels = ['P', 'M', 'G']
// Auth via sessionStorage (no cookies, no URL params)
var authPassword = sessionStorage.getItem('authPassword')
var m = location.href.match(/[?&]password=([^&]+)/)
if (m) {
  authPassword = decodeURIComponent(m[1])
  sessionStorage.setItem('authPassword', authPassword)
  history.replaceState(null, '', location.pathname)
}
var navHistory = ['folders']
var mediaTypeMap = {}
var audioPathMap = {}
var absolutePathMap = {}
var allPhotosData = []
var renderedCount = 0
var CHUNK = 100
var gridObserver = null
var loadingChunk = false

var grid = document.getElementById('gallery-content')

console.log('=== LinkGallery app.js loaded at', window.location.href)
var viewTitle = document.getElementById('view-title')
var fileInput = document.getElementById('file-input')
var sidebar = document.getElementById('sidebar')
var sidebarOverlay = document.getElementById('sidebarOverlay')
var hamburger = document.getElementById('hamburger')
var slideOverlay = document.getElementById('slideshow-overlay')
var slideImg = document.getElementById('slide-img')
var slideVideo = document.getElementById('slide-video')
var slideAudio = document.getElementById('slide-audio')
var slideCounter = document.getElementById('slideCounter')
var closeSlide = document.getElementById('close-slide')
var fsToggle = document.getElementById('fs-toggle')
var prevSlide = document.getElementById('prev-slide')
var nextSlide = document.getElementById('next-slide')
var playPauseBtn = document.getElementById('play-pause-slide')
var delSlideBtn = document.getElementById('del-slide')
var favSlideBtn = document.getElementById('fav-slide')
var confirmOverlay = document.getElementById('confirmOverlay')
var confirmModal = document.getElementById('confirmModal')
var confirmMsg = document.getElementById('confirmMsg')
var confirmYes = document.getElementById('confirmYes')
var confirmNo = document.getElementById('confirmNo')
var folderModalOverlay = document.getElementById('createFolderOverlay')
var folderModal = document.getElementById('createFolderModal')
var folderNameInput = document.getElementById('folderNameInput')
var createFolderConfirm = document.getElementById('createFolderConfirm')
var createFolderCancel = document.getElementById('createFolderCancel')
var connectModal = document.getElementById('connectModal')
var connectOverlay = document.getElementById('connectOverlay')
var connectClose = document.getElementById('connectClose')
var qrCode = document.getElementById('qrCode')
var connectUrl = document.getElementById('connectUrl')
var connectBtn = document.getElementById('connect-btn')
var settingsModal = document.getElementById('settingsModal')
var settingsOverlay = document.getElementById('settingsOverlay')
var settingsClose = document.getElementById('settingsClose')
var settingsBtn = document.getElementById('settings-btn')
var sourcePathInput = document.getElementById('sourcePathInput')
var saveSourceBtn = document.getElementById('saveSourceBtn')
var slideIntervalInput = document.getElementById('slideIntervalInput')
var saveIntervalBtn = document.getElementById('saveIntervalBtn')
var passwordInput = document.getElementById('passwordInput')
var passwordToggleBtn = document.getElementById('passwordToggleBtn')
var passwordEnabledInput = document.getElementById('passwordEnabledInput')
var savePasswordBtn = document.getElementById('savePasswordBtn')
var sizeDown = document.getElementById('size-down')
var sizeUp = document.getElementById('size-up')
var sizeDisplay = document.getElementById('sizeDisplay')
var selectToggle = document.getElementById('select-toggle')
var selectionBar = document.getElementById('selectionBar')
var selectionCount = document.getElementById('selectionCount')
var selectionClear = document.getElementById('selection-clear')
var selectionDelete = document.getElementById('selection-delete')
var selectMode = false
var selectedSet = {}
var homeFolder = ''
var backBtn = document.getElementById('backBtn')
var homeBtn = document.getElementById('homeBtn')

function pushNav(state) {
  var last = navHistory.length > 0 ? navHistory[navHistory.length - 1] : null
  if (last && JSON.stringify(last) === JSON.stringify(state)) return
  navHistory.push(state)
  backBtn.style.display = 'flex'
}

function goBack() {
  if (navHistory.length < 2) return
  navHistory.pop()
  var prev = navHistory[navHistory.length - 1]
  if (navHistory.length <= 1) backBtn.style.display = 'none'
  if (prev === 'folders' || (prev && prev.type === 'folders')) setActiveView('folders', true)
  else if (prev && prev.type === 'folder') setActiveFolder(prev.name, true)
  else if (prev) setActiveView(prev, true)
}

// ===== API =====
function api(url, opts) {
  if (authPassword) url += (url.indexOf('?') > -1 ? '&' : '?') + 'password=' + encodeURIComponent(authPassword)
  opts = opts || {}
  if (opts.body && typeof opts.body === 'string') {
    opts.headers = opts.headers || {}
    opts.headers['Content-Type'] = 'application/json'
  }
  return fetch(url, opts).then(function (r) {
    if (r.status === 401) {
      sessionStorage.removeItem('authPassword')
      authPassword = null
      showLoginOverlay()
      throw new Error('Unauthorized')
    }
    return r.json()
  })
}

// ===== SIZE CONTROL =====
function setGridSize(val) {
  gridSize = Math.max(0, Math.min(2, val))
  grid.className = 'grid ' + ['grid-sm', 'grid-md', 'grid-lg'][gridSize]
  sizeDisplay.textContent = sizeLabels[gridSize]
}
sizeDown.addEventListener('click', function () { setGridSize(gridSize - 1) })
sizeUp.addEventListener('click', function () { setGridSize(gridSize + 1) })
setGridSize(1)

// ===== SELECTION MODE =====
function exitSelectMode() {
  selectMode = false
  selectedSet = {}
  selectionBar.classList.remove('active')
  selectToggle.textContent = '☐'
  document.querySelectorAll('.grid-item').forEach(function (el) { el.classList.remove('selected') })
}
selectToggle.addEventListener('click', function () {
  selectMode = !selectMode
  selectToggle.textContent = selectMode ? '☑' : '☐'
  if (!selectMode) exitSelectMode()
})
selectionClear.addEventListener('click', exitSelectMode)
selectionDelete.addEventListener('click', function () {
  var paths = Object.keys(selectedSet)
  if (!paths.length) return
  showConfirm('Excluir ' + paths.length + ' foto' + (paths.length > 1 ? 's' : '') + '?').then(function (ok) {
    if (!ok) return
    api('/api/delete/batch', { method: 'POST', body: JSON.stringify({ paths: paths }) }).then(function () { exitSelectMode(); loadGallery() })
  })
})

// ===== GALLERY =====
async function loadGallery() {
  var data = await api('/api/gallery')
  allFolders = data.folders
  currentFavorites = data.favorites || []
  favSet = new Set(currentFavorites)
  allPhotosData = data.allPhotos

  // Build mediaTypeMap + audioPathMap + absolutePathMap
  data.allPhotos.forEach(function (p) {
    mediaTypeMap[p.path] = p.type || 'image'
    if (p.audioPath) audioPathMap[p.path] = p.audioPath
    if (p.absolutePath) absolutePathMap[p.path] = p.absolutePath
  })

  renderSidebarFolders(data.folders)
  filterAndRender(data)
}

function filterAndRender(data) {
  if (currentView === 'folders') {
    selectToggle.style.display = 'none'
    if (homeFolder) {
      var prefix = homeFolder + '/'
      var children = data.folders.filter(function (f) {
        return f.name.startsWith(prefix) && f.name.indexOf('/', prefix.length) === -1
      })
      viewTitle.textContent = '📁 ' + homeFolder
      renderFolderView(children, allPhotosData.length)
    } else {
      viewTitle.textContent = 'Pastas'
      renderFolderView(data.folders, allPhotosData.length)
    }
    return
  }
  selectToggle.style.display = ''
  var photos = []
  var title = ''
  if (currentView === 'all') { photos = allPhotosData.map(function (p) { return p.path }); title = 'Todas as Fotos' }
  else if (currentView === 'favorites') { photos = currentFavorites; title = 'Favoritos' }
  else if (currentView.type === 'folder') { photos = allPhotosData.filter(function (p) { return p.folder === currentView.name || p.folder.startsWith(currentView.name + '/') }).map(function (p) { return p.path }); title = currentView.name }
  currentPhotos = photos
  viewTitle.textContent = title
  renderedCount = 0
  renderGrid(photos)
}

function renderCurrentView() { loadGallery() }

// ===== CUSTOM CONFIRM =====
function showConfirm(msg) {
  return new Promise(function (resolve) {
    confirmMsg.textContent = msg
    confirmOverlay.classList.add('open')
    confirmModal.classList.add('open')
    function cleanup(answer) {
      confirmOverlay.classList.remove('open')
      confirmModal.classList.remove('open')
      confirmYes.onclick = null
      confirmNo.onclick = null
      resolve(answer)
    }
    confirmYes.onclick = function () { cleanup(true) }
    confirmNo.onclick = function () { cleanup(false) }
  })
}

function shortName(name) {
  return name.split('/').pop()
}

// ===== FOLDER VIEW =====
function renderFolderView(folders, totalPhotos) {
  grid.innerHTML = ''
  if (folders.length === 0) {
    grid.innerHTML = '<div class="grid-empty"><div class="empty-icon">📁</div><h3>Nenhuma pasta</h3><p>Crie uma pasta ou aponte uma pasta do PC nas Configurações</p></div>'
    return
  }
  var html = '<div class="folders-grid">'
  var allCount = totalPhotos || 0
  var allCover = folders[0] ? folders[0].cover.replace('/source/', '/thumb/') : ''
  html += '<div class="folder-card" data-view="all" tabindex="0"><img class="folder-card-cover" src="' + allCover + '" alt="" onerror="this.style.display=\'none\'"><div class="folder-card-body"><div class="folder-card-icon">🖼</div><div class="folder-card-info"><div class="folder-card-name">Todas as Fotos</div><div class="folder-card-count">' + allCount + ' foto' + (allCount !== 1 ? 's' : '') + '</div></div><div class="folder-card-arrow">→</div></div></div>'
  folders.forEach(function (f) {
    var cover = f.cover.replace('/source/', '/thumb/')
    html += '<div class="folder-card" data-name="' + f.name + '" tabindex="0"><img class="folder-card-cover" src="' + cover + '" alt="" loading="lazy" decoding="async" onerror="this.style.display=\'none\'"><div class="folder-card-body"><div class="folder-card-icon">📁</div><div class="folder-card-info"><div class="folder-card-name">' + shortName(f.name) + '</div><div class="folder-card-count">' + f.count + ' foto' + (f.count !== 1 ? 's' : '') + '</div></div><div class="folder-card-actions"><div class="folder-card-arrow">→</div><button class="folder-del-btn" data-del-folder="' + f.name + '" title="Excluir pasta">🗑</button></div></div></div>'
  })
  html += '</div>'
  grid.innerHTML = html
}

// ===== SIDEBAR FOLDERS =====
function buildFolderTree(folders) {
  var tree = {}
  folders.forEach(function (f) {
    var parts = f.name.split('/')
    var node = tree
    parts.forEach(function (part, i) {
      if (!node[part]) node[part] = { _data: null, _children: {} }
      if (i === parts.length - 1) node[part]._data = f
      node = node[part]._children
    })
  })
  return tree
}

function renderTree(node, depth, parentPath) {
  var html = ''
  var keys = Object.keys(node).sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()) })
  keys.forEach(function (key) {
    var item = node[key]
    var fullPath = parentPath ? parentPath + '/' + key : key
    var hasChildren = Object.keys(item._children).length > 0
    var count = item._data ? item._data.count : 0
    html += '<div class="tree-row">'
    html += '<span class="tree-indent" style="width:' + (depth * 20) + 'px"></span>'
    if (hasChildren) {
      html += '<span class="tree-arrow" data-path="' + fullPath + '">▶</span>'
    } else {
      html += '<span class="tree-arrow tree-arrow-empty"></span>'
    }
    html += '<button class="nav-item folder-nav" data-name="' + fullPath + '" style="flex:1"><span class="icon">📁</span>' + key + ' <span class="tree-count">' + count + '</span></button>'
    if (hasChildren) {
      html += '<span class="tree-home" data-home="' + fullPath + '" title="Pasta inicial">' + (homeFolder === fullPath ? '⭐' : '☆') + '</span>'
    }
    html += '</div>'
    if (hasChildren) {
      html += '<div class="tree-children" data-parent="' + fullPath + '">'
      html += renderTree(item._children, depth + 1, fullPath)
      html += '</div>'
    }
  })
  return html
}

function renderSidebarFolders(folders) {
  var list = document.getElementById('folder-list')
  if (!list) return
  var tree = buildFolderTree(folders)
  list.innerHTML = renderTree(tree, 0, '')
}

document.getElementById('folder-list').addEventListener('click', function (e) {
  var homeBtn = e.target.closest('.tree-home')
  if (homeBtn) {
    e.stopPropagation()
    var folder = homeBtn.dataset.home
    homeFolder = homeFolder === folder ? '' : folder
    api('/api/config', { method: 'POST', body: JSON.stringify({ homeFolder: homeFolder }) })
    this.querySelectorAll('.tree-home').forEach(function (el) {
      el.textContent = el.dataset.home === homeFolder ? '⭐' : '☆'
      el.classList.toggle('active', el.dataset.home === homeFolder)
    })
    loadGallery()
    return
  }
  var arrow = e.target.closest('.tree-arrow:not(.tree-arrow-empty)')
  if (arrow) {
    var path = arrow.dataset.path
    var children = this.querySelector('.tree-children[data-parent="' + path + '"]')
    if (children) {
      var isCollapsed = children.style.display === 'none'
      children.style.display = isCollapsed ? '' : 'none'
      arrow.textContent = isCollapsed ? '▼' : '▶'
    }
    e.stopPropagation()
    return
  }
  var btn = e.target.closest('.folder-nav')
  if (btn) { closeSidebar(); setActiveFolder(btn.dataset.name) }
})

// ===== NAV =====
function setActiveView(view, fromBack) {
  if (selectMode) exitSelectMode()
  if (view === 'folders' && homeFolder) {
    if (!fromBack) pushNav('folders')
    currentView = 'folders'
    loadGallery()
    return
  }
  if (!fromBack) pushNav(view)
  currentView = view
  document.querySelectorAll('.nav-item').forEach(function (el) { el.classList.remove('active') })
  document.querySelector('.nav-item[data-view="' + view + '"]')?.classList.add('active')
  loadGallery()
}
function setActiveFolder(name, fromBack) {
  if (selectMode) exitSelectMode()
  var state = { type: 'folder', name: name }
  if (!fromBack) pushNav(state)
  currentView = state
  document.querySelectorAll('.nav-item').forEach(function (el) { el.classList.remove('active') })
  if (homeFolder && (name === homeFolder || name.startsWith(homeFolder + '/'))) {
    document.querySelector('.nav-item[data-view="folders"]')?.classList.add('active')
  }
  loadGallery()
}

backBtn.addEventListener('click', goBack)
backBtn.style.display = navHistory.length > 1 ? 'flex' : 'none'
homeBtn.addEventListener('click', function () { setActiveView('folders') })

// ===== SIDEBAR =====
function closeSidebar() { sidebar.classList.remove('open'); sidebarOverlay.classList.remove('open') }
hamburger.addEventListener('click', function () { sidebar.classList.add('open'); sidebarOverlay.classList.add('open') })
sidebarOverlay.addEventListener('click', closeSidebar)
sidebar.addEventListener('click', function (e) {
  var item = e.target.closest('.nav-item[data-view]')
  if (item) { closeSidebar(); setActiveView(item.dataset.view) }
})

// ===== GRID =====
function renderGrid(photos) {
  grid.innerHTML = ''
  if (!photos.length) {
    grid.innerHTML = '<div class="grid-empty"><div class="empty-icon">📸</div><h3>Nenhuma foto</h3><p>Envie fotos ou clique em uma pasta para ver as imagens</p></div>'
    return
  }
  var chunk = photos.slice(0, CHUNK)
  renderedCount = chunk.length
  grid.innerHTML = buildGridHTML(chunk, 0)
  grid.insertAdjacentHTML('beforeend', '<div id="scroll-sentinel"></div>')
  setupGridObserver()
}

function favfileUrl(photo) {
  var url = '/api/favfile?path=' + encodeURIComponent(photo)
  if (authPassword) url += '&password=' + encodeURIComponent(authPassword)
  return url
}

function buildGridHTML(photos, startIdx) {
  var html = ''
  photos.forEach(function (photo, i) {
    var idx = startIdx + i
    var absPath = absolutePathMap[photo] || photo
    var isFav = favSet.has(absPath)
    var sel = selectedSet[photo] ? ' selected' : ''
    var isVideo = mediaTypeMap[photo] === 'video'
    html += '<div class="grid-item' + sel + '" data-idx="' + idx + '" tabindex="0">'
    if (isVideo) {
      html += '<video src="' + (photo.indexOf('/source/') === 0 ? photo : favfileUrl(photo)) + '" preload="metadata" muted playsinline></video>'
      html += '<div class="video-play-icon">▶</div>'
    } else {
      html += '<img src="' + (photo.indexOf('/source/') === 0 ? photo.replace('/source/', '/thumb/') : favfileUrl(photo)) + '" alt="" loading="lazy" decoding="async">'
    }
    html += '<div class="item-overlay">'
    html += '<button class="item-btn ' + (isFav ? 'fav-active' : '') + '" data-action="fav">' + (isFav ? '⭐' : '☆') + '</button>'
    html += '<button class="item-btn danger" data-action="del">🗑</button>'
    if (selectMode) html += '<input type="checkbox" class="item-check" data-action="check"' + (sel ? ' checked' : '') + '>'
    html += '</div></div>'
  })
  return html
}

function loadMoreChunk() {
  if (loadingChunk) return
  loadingChunk = true
  var remaining = currentPhotos.slice(renderedCount, renderedCount + CHUNK)
  if (!remaining.length) { loadingChunk = false; return }
  var oldSentinel = document.getElementById('scroll-sentinel')
  if (oldSentinel) oldSentinel.remove()
  grid.insertAdjacentHTML('beforeend', buildGridHTML(remaining, renderedCount))
  renderedCount += remaining.length
  if (renderedCount < currentPhotos.length) {
    grid.insertAdjacentHTML('beforeend', '<div id="scroll-sentinel"></div>')
    setupGridObserver()
  }
  loadingChunk = false
}

function setupGridObserver() {
  if (gridObserver) gridObserver.disconnect()
  var sentinel = document.getElementById('scroll-sentinel')
  if (!sentinel) return
  gridObserver = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) loadMoreChunk()
  }, { rootMargin: '400px' })
  gridObserver.observe(sentinel)
}

grid.addEventListener('click', function (e) {
  var delBtn = e.target.closest('[data-del-folder]')
  if (delBtn) {
    var folderName = delBtn.dataset.delFolder
    showConfirm('Excluir pasta "' + shortName(folderName) + '" e todo seu conteúdo?').then(function (ok) {
      if (!ok) return
      api('/api/folder/delete', { method: 'POST', body: JSON.stringify({ name: folderName }) }).then(loadGallery)
    })
    return
  }
  var card = e.target.closest('.folder-card[data-view="all"]')
  if (card) { closeSidebar(); setActiveView('all'); return }
  card = e.target.closest('.folder-card[data-name]')
  if (card) { closeSidebar(); setActiveFolder(card.dataset.name); return }

  var item = e.target.closest('.grid-item')
  if (!item) return
  var idx = parseInt(item.dataset.idx)

  if (selectMode) {
    var check = e.target.closest('[data-action="check"]')
    if (check) {
      if (selectedSet[currentPhotos[idx]]) { delete selectedSet[currentPhotos[idx]]; item.classList.remove('selected') }
      else { selectedSet[currentPhotos[idx]] = true; item.classList.add('selected') }
      var count = Object.keys(selectedSet).length
      selectionCount.textContent = count + ' selecionada' + (count !== 1 ? 's' : '')
      selectionBar.classList.toggle('active', count > 0)
      selectionDelete.textContent = '🗑 Excluir ' + (count || '')
      return
    }
    return
  }

  var btn = e.target.closest('[data-action]')
  if (btn) {
    var action = btn.dataset.action
    if (action === 'fav') toggleFavorite(currentPhotos[idx])
    else if (action === 'del') {
      showConfirm('Excluir esta foto?').then(function (ok) {
        if (!ok) return
        api('/api/delete', { method: 'POST', body: JSON.stringify({ path: currentPhotos[idx] }) }).then(loadGallery)
      })
    }
    return
  }

  openViewer(idx)
})

grid.addEventListener('error', function (e) {
  if (e.target.tagName !== 'IMG') return
  var parent = e.target.closest('.grid-item')
  if (parent) parent.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:40px;color:#555;background:#1a1a2e">🖼</div>'
}, true)

// ===== FAVORITES =====
function toggleFavorite(path) {
  api('/api/favorite', { method: 'POST', body: JSON.stringify({ photoPath: path }) }).then(function (data) {
    currentFavorites = data.favorites
    favSet = new Set(currentFavorites)
    if (slideOverlay.classList.contains('active')) {
      var isFav = favSet.has(absolutePathMap[currentPhotos[slideIndex]] || currentPhotos[slideIndex])
      favSlideBtn.textContent = isFav ? '⭐' : '☆'
    }
    loadGallery()
  })
}

// ===== ZOOM =====
function resetZoom() { zoomLevel = 1; panX = 0; panY = 0; slideImg.style.transform = ''; slideVideo.style.transform = ''; slideImg.style.cursor = ''; slideVideo.style.cursor = '' }
function clampPan() {
  if (zoomLevel <= 1) { panX = 0; panY = 0; return }
  var el = slideImg.style.display !== 'none' ? slideImg : slideVideo
  var w = el.offsetWidth, h = el.offsetHeight
  var maxX = (zoomLevel - 1) * w / 2
  var maxY = (zoomLevel - 1) * h / 2
  panX = Math.max(-maxX, Math.min(maxX, panX))
  panY = Math.max(-maxY, Math.min(maxY, panY))
}
function applyZoom() {
  clampPan()
  var el = slideImg.style.display !== 'none' ? slideImg : slideVideo
  if (zoomLevel === 1 && panX === 0 && panY === 0) { el.style.transform = ''; el.style.cursor = ''; return }
  el.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoomLevel + ')'
  el.style.cursor = zoomLevel > 1 ? 'grab' : ''
}
slideImg.addEventListener('wheel', function (e) {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); return }
  var rect = this.getBoundingClientRect()
  var mx = (e.clientX - rect.left) / rect.width
  var my = (e.clientY - rect.top) / rect.height
  var delta = e.deltaY > 0 ? -0.1 : 0.1
  var prev = zoomLevel
  zoomLevel = Math.max(1, Math.min(10, zoomLevel + delta))
  if (zoomLevel !== 1) {
    panX += (mx - 0.5) * (prev - zoomLevel) * rect.width / 2
    panY += (my - 0.5) * (prev - zoomLevel) * rect.height / 2
  } else {
    panX = 0; panY = 0
  }
  applyZoom()
})
slideVideo.addEventListener('wheel', function (e) {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); return }
  var rect = this.getBoundingClientRect()
  var mx = (e.clientX - rect.left) / rect.width
  var my = (e.clientY - rect.top) / rect.height
  var delta = e.deltaY > 0 ? -0.1 : 0.1
  var prev = zoomLevel
  zoomLevel = Math.max(1, Math.min(10, zoomLevel + delta))
  if (zoomLevel !== 1) {
    panX += (mx - 0.5) * (prev - zoomLevel) * rect.width / 2
    panY += (my - 0.5) * (prev - zoomLevel) * rect.height / 2
  } else {
    panX = 0; panY = 0
  }
  applyZoom()
})
slideImg.addEventListener('dragstart', function (e) { e.preventDefault() })
slideVideo.addEventListener('dragstart', function (e) { e.preventDefault() })
// Drag to pan when zoomed
var dragStart = null
var wasDrag = false
slideImg.addEventListener('mousedown', function (e) { wasDrag = false; if (zoomLevel > 1) { dragStart = { x: e.clientX - panX, y: e.clientY - panY }; this.style.cursor = 'grabbing' } })
slideVideo.addEventListener('mousedown', function (e) { wasDrag = false; if (zoomLevel > 1) { dragStart = { x: e.clientX - panX, y: e.clientY - panY }; this.style.cursor = 'grabbing' } })
document.addEventListener('mousemove', function (e) {
  if (!dragStart) return
  wasDrag = true
  panX = e.clientX - dragStart.x
  panY = e.clientY - dragStart.y
  applyZoom()
})
document.addEventListener('mouseup', function () { dragStart = null; if (slideImg.style.cursor === 'grabbing') slideImg.style.cursor = zoomLevel > 1 ? 'grab' : ''; if (slideVideo.style.cursor === 'grabbing') slideVideo.style.cursor = zoomLevel > 1 ? 'grab' : '' })
// Double-click to reset zoom + toggle fullscreen
var clickTimer = null
function handleImageClick(e) {
  if (wasDrag) return
  if (clickTimer) {
    clearTimeout(clickTimer); clickTimer = null
    e.preventDefault()
    resetZoom()
    toggleFullscreen()
    return
  }
  clickTimer = setTimeout(function () { clickTimer = null }, 300)
}
slideImg.addEventListener('click', handleImageClick)
slideVideo.addEventListener('click', handleImageClick)
// Touch pinch zoom
slideImg.addEventListener('touchstart', function (e) { if (e.touches.length === 2) pinchStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) })
slideVideo.addEventListener('touchstart', function (e) { if (e.touches.length === 2) pinchStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) })
slideImg.addEventListener('touchmove', function (e) {
  if (e.touches.length !== 2 || !pinchStartDist) return
  e.preventDefault()
  var dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
  var prev = zoomLevel
  zoomLevel = Math.max(1, Math.min(10, zoomLevel * (dist / pinchStartDist)))
  pinchStartDist = dist
  if (zoomLevel === 1) { panX = 0; panY = 0 }
  applyZoom()
})
slideVideo.addEventListener('touchmove', function (e) {
  if (e.touches.length !== 2 || !pinchStartDist) return
  e.preventDefault()
  var dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
  var prev = zoomLevel
  zoomLevel = Math.max(1, Math.min(10, zoomLevel * (dist / pinchStartDist)))
  pinchStartDist = dist
  if (zoomLevel === 1) { panX = 0; panY = 0 }
  applyZoom()
})

// ===== SLIDESHOW =====
function openViewer(index) {
  if (!currentPhotos.length) return
  slideIndex = index; isPlaying = false
  playPauseBtn.textContent = '▶'
  slideOverlay.classList.add('active')
  showSlide()
  clearTimeout(slideInterval)
  slideInterval = null
}

function startSlideshow(index) {
  if (!currentPhotos.length) return
  slideIndex = index; isPlaying = true
  playPauseBtn.textContent = '⏸'
  slideOverlay.classList.add('active')
  showSlide()
}
function showSlide() {
  resetZoom()
  var path = currentPhotos[slideIndex]
  var isVideo = mediaTypeMap[path] === 'video'
  var audioPath = audioPathMap[path] || null

  slideImg.style.display = isVideo ? 'none' : ''
  slideVideo.style.display = isVideo ? '' : 'none'
  slideAudio.style.display = 'none'
  slideAudio.pause()
  slideAudio.src = ''
  clearTimeout(slideInterval)
  slideInterval = null

  if (isVideo) {
    slideVideo.src = path.indexOf('/source/') === 0 ? path : favfileUrl(path)
    slideVideo.currentTime = 0
    slideVideo.loop = !isPlaying
    slideVideo.play()
    slideVideo.onended = isPlaying ? function () { goNextSlide() } : null
  } else {
    slideVideo.pause()
    slideVideo.src = ''
    slideVideo.onended = null
    if (audioPath) {
      slideAudio.src = audioPath
      slideAudio.style.display = ''
      slideAudio.play()
    }
    if (isPlaying) {
      var fallbackTimer = setTimeout(goNextSlide, (slideTime + 3) * 1000)
      slideImg.onload = function () {
        clearTimeout(fallbackTimer)
        clearTimeout(slideInterval)
        slideInterval = setTimeout(goNextSlide, slideTime * 1000)
      }
      slideImg.onerror = function () {
        clearTimeout(fallbackTimer)
        clearTimeout(slideInterval)
        slideInterval = setTimeout(goNextSlide, slideTime * 1000)
      }
    } else {
      slideImg.onload = null
      slideImg.onerror = null
    }
    slideImg.src = path.indexOf('/source/') === 0 ? path : favfileUrl(path)
  }
  slideCounter.textContent = (slideIndex + 1) + ' / ' + currentPhotos.length
  var isFav = favSet.has(absolutePathMap[path] || path)
  favSlideBtn.textContent = isFav ? '⭐' : '☆'
}
function goNextSlide() { if (!currentPhotos.length) return; slideIndex = (slideIndex + 1) % currentPhotos.length; showSlide() }
function goPrevSlide() { if (!currentPhotos.length) return; slideIndex = (slideIndex - 1 + currentPhotos.length) % currentPhotos.length; showSlide() }
function closeSlideshow() { slideOverlay.classList.remove('active'); if (document.fullscreenElement) document.exitFullscreen(); clearTimeout(slideInterval); clearTimeout(fsHideTimer); slideVideo.pause(); slideVideo.src = ''; slideAudio.pause(); slideAudio.src = '' }
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    slideOverlay.requestFullscreen()
  }
}
var fsHideTimer = null
function showFsControls() {
  slideOverlay.classList.remove('fs-hide')
  clearTimeout(fsHideTimer)
  if (document.fullscreenElement) {
    fsHideTimer = setTimeout(function () { slideOverlay.classList.add('fs-hide') }, 3000)
  }
}
document.addEventListener('fullscreenchange', function () {
  fsToggle.textContent = document.fullscreenElement ? '✕' : '⛶'
  slideOverlay.classList.toggle('fullscreen', !!document.fullscreenElement)
  if (document.fullscreenElement) showFsControls()
  else slideOverlay.classList.remove('fs-hide')
})
slideOverlay.addEventListener('mousemove', showFsControls)
slideOverlay.addEventListener('keydown', showFsControls)
function togglePlayPause() {
  var path = currentPhotos[slideIndex]
  var isVideo = mediaTypeMap[path] === 'video'
  if (isVideo) {
    isPlaying = slideVideo.paused
    if (slideVideo.paused) {
      slideVideo.loop = false
      slideVideo.play()
      slideVideo.onended = function () { goNextSlide() }
      playPauseBtn.textContent = '⏸'
    } else {
      slideVideo.loop = true
      slideVideo.pause()
      slideVideo.onended = null
      playPauseBtn.textContent = '▶'
    }
    return
  }
  isPlaying = !isPlaying
  playPauseBtn.textContent = isPlaying ? '⏸' : '▶'
  if (isPlaying) {
    // Restart the timer for current slide
    clearTimeout(slideInterval)
    var fallbackTimer = setTimeout(goNextSlide, (slideTime + 3) * 1000)
    slideImg.onload = function () {
      clearTimeout(fallbackTimer)
      clearTimeout(slideInterval)
      slideInterval = setTimeout(goNextSlide, slideTime * 1000)
    }
    slideImg.onerror = function () {
      clearTimeout(fallbackTimer)
      clearTimeout(slideInterval)
      slideInterval = setTimeout(goNextSlide, slideTime * 1000)
    }
  } else {
    clearTimeout(slideInterval)
    slideInterval = null
  }
}

closeSlide.addEventListener('click', closeSlideshow)
fsToggle.addEventListener('click', toggleFullscreen)
// Double-click outside image to close slideshow
var closeSlideTimer = null
slideOverlay.addEventListener('click', function (e) {
  if (e.target !== slideOverlay) return
  if (closeSlideTimer) {
    clearTimeout(closeSlideTimer); closeSlideTimer = null
    closeSlideshow()
    return
  }
  closeSlideTimer = setTimeout(function () { closeSlideTimer = null }, 300)
})
prevSlide.addEventListener('click', goPrevSlide)
nextSlide.addEventListener('click', goNextSlide)
playPauseBtn.addEventListener('click', togglePlayPause)
favSlideBtn.addEventListener('click', function () {
  if (!currentPhotos.length) return
  toggleFavorite(currentPhotos[slideIndex])
})
delSlideBtn.addEventListener('click', function () {
  if (!currentPhotos.length) return
  var photo = currentPhotos[slideIndex]
  showConfirm('Excluir "' + photo.split('/').pop() + '" ?').then(function (ok) {
    if (!ok) return
    api('/api/delete', { method: 'POST', body: JSON.stringify({ path: photo }) }).then(function () { closeSlideshow(); loadGallery() })
  })
})

document.addEventListener('keydown', function (e) {
  if (e.code === 'Space') { e.preventDefault(); if (slideOverlay.classList.contains('active')) togglePlayPause(); else if (currentPhotos.length) startSlideshow(0) }
  if (e.code === 'Escape') { if (!document.fullscreenElement) closeSlideshow() }
  if (slideOverlay.classList.contains('active')) {
    if (e.code === 'ArrowRight') { e.preventDefault(); goNextSlide() }
    if (e.code === 'ArrowLeft') { e.preventDefault(); goPrevSlide() }
    return
  }
  // Grid navigation (TV / keyboard)
  var items = grid.querySelectorAll('.grid-item, .folder-card')
  if (!items.length) return
  if (e.code === 'ArrowRight' || e.code === 'ArrowDown') {
    e.preventDefault()
    var idx = Array.from(items).indexOf(document.activeElement)
    if (idx < items.length - 1) items[idx + 1].focus()
    else items[0].focus()
  } else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
    e.preventDefault()
    var idx = Array.from(items).indexOf(document.activeElement)
    if (idx > 0) items[idx - 1].focus()
    else items[items.length - 1].focus()
  } else if (e.code === 'Enter') {
    var focused = document.activeElement
    if (focused && focused.closest('.grid-item, .folder-card')) {
      e.preventDefault()
      focused.click()
    }
  }
})

// Touch pan/swipe for slideshow (mobile)
var touchStartX = null, touchStartY = null, touchMoved = false
function slideTouchStart(e) {
  if (e.touches.length !== 1) return
  touchStartX = e.touches[0].clientX
  touchStartY = e.touches[0].clientY
  touchMoved = false
  if (zoomLevel > 1) {
    wasDrag = false
    dragStart = { x: touchStartX - panX, y: touchStartY - panY }
  }
}
function slideTouchMove(e) {
  if (e.touches.length !== 1 || !dragStart || zoomLevel <= 1) return
  e.preventDefault()
  touchMoved = true
  wasDrag = true
  panX = e.touches[0].clientX - dragStart.x
  panY = e.touches[0].clientY - dragStart.y
  applyZoom()
}
function slideTouchEnd(e) {
  dragStart = null
  if (pinchStartDist !== 0) { pinchStartDist = 0; touchStartX = null; return }
  if (touchStartX === null) return
  var diff = touchStartX - e.changedTouches[0].clientX
  if (zoomLevel > 1 && touchMoved) {
    // Edge swipe when zoomed: navigate if at boundary and finger moved beyond
    var el = slideImg.style.display !== 'none' ? slideImg : slideVideo
    var w = el.offsetWidth
    var maxX = (zoomLevel - 1) * w / 2
    if (Math.abs(diff) > 50) {
      if (diff > 0 && panX <= -maxX + 2) { goNextSlide(); touchStartX = null; return }
      if (diff < 0 && panX >= maxX - 2) { goPrevSlide(); touchStartX = null; return }
    }
    touchStartX = null; return
  }
  if (Math.abs(diff) > 50) {
    if (diff > 0) goNextSlide(); else goPrevSlide()
  }
  touchStartX = null
}
slideImg.addEventListener('touchstart', slideTouchStart)
slideVideo.addEventListener('touchstart', slideTouchStart)
slideImg.addEventListener('touchmove', slideTouchMove, { passive: false })
slideVideo.addEventListener('touchmove', slideTouchMove, { passive: false })
slideImg.addEventListener('touchend', slideTouchEnd)
slideVideo.addEventListener('touchend', slideTouchEnd)

// ===== FOLDER / UPLOAD =====
function getCurrentFolder() {
  if (currentView.type === 'folder') return currentView.name
  if (currentView === 'folders' && homeFolder) return homeFolder
  return 'geral'
}

function showCreateFolder() {
  folderNameInput.value = ''
  var ctx = document.getElementById('createFolderContext')
  if (ctx) {
    var folder = getCurrentFolder()
    ctx.textContent = folder !== 'geral' ? 'Dentro de: ' + folder : ''
  }
  folderNameInput.focus()
  folderModalOverlay.classList.add('open')
  folderModal.classList.add('open')
}

function hideCreateFolder() {
  folderModalOverlay.classList.remove('open')
  folderModal.classList.remove('open')
}

createFolderConfirm.addEventListener('click', async function () {
  var name = folderNameInput.value.trim()
  if (!name) return
  var prefix = getCurrentFolder()
  var fullName = prefix !== 'geral' ? prefix + '/' + name : name
  await api('/api/folder', { method: 'POST', body: JSON.stringify({ name: fullName }) })
  hideCreateFolder()
  setActiveView('folders')
})

createFolderCancel.addEventListener('click', hideCreateFolder)
folderModalOverlay.addEventListener('click', hideCreateFolder)
document.getElementById('create-folder-btn').addEventListener('click', showCreateFolder)
document.getElementById('create-folder-top-btn')?.addEventListener('click', showCreateFolder)

folderNameInput.addEventListener('keydown', function (e) {
  if (e.code === 'Enter') createFolderConfirm.click()
})

// ===== UPLOAD =====
fileInput.addEventListener('change', function () {
  var form = new FormData()
  var folder = getCurrentFolder()
  if (folder !== 'geral') form.append('folderName', folder)
  Array.from(fileInput.files).forEach(function (f) { form.append('photos', f) })
  api('/api/upload', { method: 'POST', body: form }).then(function () { fileInput.value = ''; loadGallery() })
})

document.getElementById('upload-btn').addEventListener('click', function () { fileInput.click() })
document.getElementById('upload-btn-top').addEventListener('click', function () { fileInput.click() })

grid.addEventListener('dragover', function (e) { e.preventDefault(); grid.style.outline = '2px dashed var(--accent-2)' })
grid.addEventListener('dragleave', function () { grid.style.outline = '' })
grid.addEventListener('drop', function (e) {
  e.preventDefault()
  grid.style.outline = ''
  var form = new FormData()
  var folder = getCurrentFolder()
  if (folder !== 'geral') form.append('folderName', folder)
  Array.from(e.dataTransfer.files).forEach(function (f) { form.append('photos', f) })
  api('/api/upload', { method: 'POST', body: form }).then(loadGallery)
})

// ===== CONNECT =====
connectBtn.addEventListener('click', function () {
  api('/api/network').then(function (data) {
    networkUrl = data.url
    connectUrl.childNodes[0].textContent = data.url + ' '
    qrCode.src = 'https://api.qrserver.com/v1/create-qr-code/?data=' + encodeURIComponent(data.url) + '&size=250x250'
  })
  connectOverlay.classList.add('open')
  connectModal.classList.add('open')
})
connectClose.addEventListener('click', function () { connectOverlay.classList.remove('open'); connectModal.classList.remove('open') })
connectOverlay.addEventListener('click', function () { connectOverlay.classList.remove('open'); connectModal.classList.remove('open') })
var copyUrlBtn = document.getElementById('copyUrlBtn')
copyUrlBtn.addEventListener('click', function (e) {
  e.stopPropagation()
  if (!navigator.clipboard) return
  navigator.clipboard.writeText(networkUrl || connectUrl.childNodes[0].textContent.trim())
  copyUrlBtn.textContent = 'Copiado!'
  setTimeout(function () { copyUrlBtn.textContent = 'Copiar' }, 2000)
})

// ===== SETTINGS =====
settingsBtn.addEventListener('click', function () {
  api('/api/config').then(function (cfg) {
    sourcePathInput.value = cfg.sourcePath
    slideIntervalInput.value = cfg.slideInterval
    passwordInput.value = cfg.password || ''
    passwordEnabledInput.checked = cfg.passwordEnabled !== false
  })
  settingsOverlay.classList.add('open')
  settingsModal.classList.add('open')
  // Auto-open folder browser to current path
  setTimeout(function () {
    if (!fbLoaded) {
      fbLoaded = true
      fbBody.classList.add('open')
      fbToggle.querySelector('.fb-arrow').classList.add('open')
      loadDrives(true)
    } else {
      fbBody.classList.add('open')
      fbToggle.querySelector('.fb-arrow').classList.add('open')
      if (sourcePathInput.value) expandToPath(sourcePathInput.value)
    }
  }, 100)
})
settingsClose.addEventListener('click', function () { settingsOverlay.classList.remove('open'); settingsModal.classList.remove('open') })
settingsOverlay.addEventListener('click', function () { settingsOverlay.classList.remove('open'); settingsModal.classList.remove('open') })
saveSourceBtn.addEventListener('click', function () {
  api('/api/config', { method: 'POST', body: JSON.stringify({ sourcePath: sourcePathInput.value }) }).then(function () { settingsOverlay.classList.remove('open'); settingsModal.classList.remove('open'); loadGallery() })
})
saveIntervalBtn.addEventListener('click', function () {
  api('/api/config', { method: 'POST', body: JSON.stringify({ slideInterval: parseFloat(slideIntervalInput.value) }) }).then(function (cfg) { slideTime = cfg.slideInterval })
})
passwordToggleBtn.addEventListener('click', function () {
  passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password'
  passwordToggleBtn.textContent = passwordInput.type === 'password' ? '👁' : '🙈'
})
savePasswordBtn.addEventListener('click', function () {
  api('/api/config', {
    method: 'POST',
    body: JSON.stringify({ password: passwordInput.value, passwordEnabled: passwordEnabledInput.checked })
  }).then(function (cfg) {
    if (cfg.relogin) {
      settingsOverlay.classList.remove('open'); settingsModal.classList.remove('open')
      sessionStorage.removeItem('authPassword')
      location.href = '/?_=' + (+new Date())
    }
  })
})
var logoutBtn = document.getElementById('logoutBtn')
logoutBtn.addEventListener('click', function () {
  settingsOverlay.classList.remove('open'); settingsModal.classList.remove('open')
  sessionStorage.removeItem('authPassword')
  location.href = '/?_=' + (+new Date())
})

// ===== FOLDER BROWSER =====
var fbToggle = document.getElementById('fbToggle')
var fbBody = document.getElementById('fbBody')
var fbLoaded = false
fbToggle.addEventListener('click', function () {
  fbBody.classList.toggle('open')
  fbToggle.querySelector('.fb-arrow').classList.toggle('open')
  if (!fbLoaded) { fbLoaded = true; loadDrives(true) }
})
function loadDrives(expandToCurrent) {
  fbBody.innerHTML = '<div class="fb-loading">Carregando...</div>'
  api('/api/browse').then(function (drives) {
    fbBody.innerHTML = ''
    drives.forEach(function (d) {
      fbBody.appendChild(createFolderItem(d, 0))
    })
    if (expandToCurrent && sourcePathInput.value) expandToPath(sourcePathInput.value)
  })
}
function expandToPath(target) {
  var parts = target.replace(/\\/g, '/').replace(/\/$/, '').split('/')
  var current = parts.shift() + '\\'
  var items = fbBody.querySelectorAll('.fb-item')
  for (var i = 0; i < items.length; i++) {
    if (items[i].dataset.path === current || items[i].dataset.path === current + '\\') {
      expandItem(items[i], parts)
      break
    }
  }
}
function expandItem(div, remainingParts) {
  if (!remainingParts.length) { div.classList.add('active'); return }
  var target = remainingParts[0]
  var state = div.dataset.fbState || 'unloaded'
  if (state === 'loading') {
    // Wait and retry shortly
    setTimeout(function () { expandItem(div, remainingParts) }, 200)
  } else if (state === 'unloaded') {
    loadChildren(div, function () { expandItem(div, remainingParts) })
  } else if (state === 'collapsed') {
    toggleExpand(div, function () { expandItem(div, remainingParts) })
  } else if (state === 'expanded') {
    // Already expanded, find the child
    var childPath = div.dataset.path.replace(/\\/g, '/').replace(/\/$/, '') + '/' + target
    childPath = childPath.replace(/\//g, '\\')
    var next = div.nextSibling
    while (next && next.classList && next.classList.contains('fb-item') && parseInt(next.style.paddingLeft) > parseInt(div.style.paddingLeft)) {
      if (next.dataset.path === childPath || next.dataset.path === childPath + '\\') {
        expandItem(next, remainingParts.slice(1))
        break
      }
      next = next.nextSibling
    }
  }
  // 'empty' or unknown state: can't expand further
}
function loadChildren(div, cb) {
  div.dataset.fbState = 'loading'
  div.querySelector('.fb-toggle').textContent = '🔄'
  api('/api/browse?path=' + encodeURIComponent(div.dataset.path)).then(function (children) {
    if (!children.length) {
      div.dataset.fbState = 'empty'
      div.querySelector('.fb-toggle').textContent = ''
      if (cb) cb()
      return
    }
    div.dataset.fbState = 'expanded'
    div.querySelector('.fb-toggle').textContent = '▼'
    var depth = parseInt(div.style.paddingLeft)
    depth = Math.round((depth - 26) / 20)
    children.forEach(function (c) {
      div.parentNode.insertBefore(createFolderItem(c, depth + 1), div.nextSibling)
    })
    if (cb) cb()
  })
}
function toggleExpand(div, cb) {
  var state = div.dataset.fbState
  if (state === 'expanded') {
    // Collapse
    div.dataset.fbState = 'collapsed'
    div.querySelector('.fb-toggle').textContent = '▶'
    div.classList.remove('active')
    var depth = parseInt(div.style.paddingLeft)
    var next = div.nextSibling
    while (next && next.classList && next.classList.contains('fb-item') && parseInt(next.style.paddingLeft) > depth) {
      var toRemove = next
      next = next.nextSibling
      toRemove.remove()
    }
    if (cb) cb()
  } else {
    // Expand
    div.dataset.fbState = 'loading'
    div.querySelector('.fb-toggle').textContent = '🔄'
    api('/api/browse?path=' + encodeURIComponent(div.dataset.path)).then(function (children) {
      if (!children.length) {
        div.dataset.fbState = 'empty'
        div.querySelector('.fb-toggle').textContent = ''
        if (cb) cb()
        return
      }
      div.dataset.fbState = 'expanded'
      div.querySelector('.fb-toggle').textContent = '▼'
      div.classList.add('active')
      var depth = parseInt(div.style.paddingLeft)
      depth = Math.round((depth - 26) / 20)
      children.forEach(function (c) {
        div.parentNode.insertBefore(createFolderItem(c, depth + 1), div.nextSibling)
      })
      if (cb) cb()
    })
  }
}
function createFolderItem(entry, depth) {
  var div = document.createElement('div')
  div.className = 'fb-item'
  div.style.paddingLeft = (26 + depth * 20) + 'px'
  div.dataset.path = entry.path
  var toggle = document.createElement('span')
  toggle.className = 'fb-toggle'
  toggle.textContent = ''
  div.appendChild(toggle)
  var icon = document.createElement('span')
  icon.className = 'fb-icon'
  icon.textContent = entry.hidden ? '📁' : '📂'
  div.appendChild(icon)
  var label = document.createElement('span')
  label.textContent = entry.name
  div.appendChild(label)
  div.addEventListener('click', function (e) {
    e.stopPropagation()
    sourcePathInput.value = entry.path
    var state = div.dataset.fbState
    if (state === 'loading') return
    if (!state || state === 'unloaded') {
      loadChildren(div)
    } else if (state === 'collapsed' || state === 'expanded') {
      toggleExpand(div)
    }
  })
  return div
}
var netHint = document.getElementById('netHint')
var loginOverlay = document.getElementById('loginOverlay')
var loginPassword = document.getElementById('loginPassword')
var loginError = document.getElementById('loginError')
var loginBtn = document.getElementById('loginBtn')

function doLogin() {
  var pwd = loginPassword.value
  loginError.style.display = 'none'
  fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd })
  }).then(function (r) {
    if (r.ok) {
      authPassword = pwd
      sessionStorage.setItem('authPassword', authPassword)
      loginOverlay.style.display = 'none'
      doLoadGallery()
    } else {
      loginError.textContent = 'Senha incorreta'
      loginError.style.display = ''
      loginPassword.value = ''
      loginPassword.focus()
    }
  }).catch(function () {
    loginError.textContent = 'Erro de conexão'
    loginError.style.display = ''
  })
}

function showLoginOverlay() {
  loginOverlay.style.display = 'flex'
  loginPassword.value = ''
  loginPassword.focus()
  loginError.style.display = 'none'
}

function init() {
  if (authPassword) {
    doLoadGallery()
    return
  }
  fetch('/api/auth/status').then(function (r) { return r.json() }).then(function (status) {
    if (status.passwordEnabled) {
      showLoginOverlay()
      loginBtn.addEventListener('click', doLogin)
      loginPassword.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') doLogin()
      })
    } else {
      doLoadGallery()
    }
  }).catch(function () {
    doLoadGallery()
  })
}

function doLoadGallery() {
  api('/api/config').then(function (cfg) {
    homeFolder = cfg.homeFolder || ''
    slideTime = cfg.slideInterval || 3
    loadGallery()
  })
  api('/api/network').then(function (data) {
    if (!data.url) return
    if (localStorage.getItem('netHintDismissed')) return
    netHint.textContent = '📱 Acesse de outro dispositivo: '
    var strong = document.createElement('strong')
    strong.textContent = data.url
    netHint.appendChild(strong)
    netHint.classList.add('show')
    netHint.addEventListener('click', function () { netHint.classList.remove('show'); localStorage.setItem('netHintDismissed', '1') })
    setTimeout(function () { netHint.classList.remove('show') }, 8000)
  })
}
init()
