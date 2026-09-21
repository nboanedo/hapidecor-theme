/**
 * SKU Search Enhancement for Shopify
 * Matches the theme's native predictive search UI exactly.
 */
(function () {
  var tokenEl = document.querySelector('[data-storefront-token]');
  if (!tokenEl) return;
  var TOKEN = tokenEl.dataset.storefrontToken;
  var SHOP = (window.Shopify && window.Shopify.shop) || window.location.hostname;
  if (!TOKEN) return;

  // Inject CSS to prevent "No results" flash in predictive search.
  // Empty state starts invisible and fades in after 400ms — enough time
  // for the MutationObserver to replace it with SKU results.
  // If replaced, the flash never happens. If not, it fades in gracefully.
  var style = document.createElement('style');
  style.textContent =
    '[id^="PredictiveSearchResults"] [class*="empty-state"] {' +
    '  animation: _skuDelay 0.4s ease forwards; }' +
    '@keyframes _skuDelay { 0%,80% { opacity:0 } 100% { opacity:1 } }';
  document.head.appendChild(style);

  initSearchResultsPage();
  initPredictiveSearch();

  /* ═══ 1. Search Results Page ═══ */
  function initSearchResultsPage() {
    var c = document.getElementById('sku-search-results');
    if (!c) return;
    var term = c.dataset.searchTerm;
    if (!term || term.trim().length < 3 || c.dataset.hasResults === 'true') {
      c.style.opacity = '1';
      return;
    }
    searchBySKU(term.trim()).then(function (items) {
      c.innerHTML = items.length ? renderPageCards(items, term.trim()) : renderNoResults(term.trim());
      c.style.opacity = '1';
    });
  }

  /* ═══ 2. Predictive Search ═══ */
  function initPredictiveSearch() {
    var timer = null;
    var reqId = 0;
    var cachedHTML = '';
    var cachedQuery = '';
    var observer = null;

    document.addEventListener('input', function (e) {
      var input = e.target;
      if (!input.matches || !input.matches('input[type="search"]')) return;
      var q = input.value.trim();
      clearTimeout(timer);
      disconnectObs();

      // Reset cache when query changes
      if (q !== cachedQuery) cachedHTML = '';
      if (q.length < 3) { cachedHTML = ''; cachedQuery = ''; return; }

      timer = setTimeout(function () {
        if (cachedHTML) { connectObs(input); return; }
        var id = ++reqId;
        searchBySKU(q).then(function (items) {
          if (id !== reqId || items.length === 0) return;
          cachedQuery = q;
          cachedHTML = renderDropdown(items, q);
          connectObs(input);
        });
      }, 500);
    }, true);

    function connectObs(input) {
      disconnectObs();
      var ps = input.closest('predictive-search');
      if (!ps) return;
      var resultsDiv = ps.querySelector('[id^="PredictiveSearchResults"]');
      if (!resultsDiv) return;

      tryInject(resultsDiv);

      observer = new MutationObserver(function () { tryInject(resultsDiv); });
      observer.observe(resultsDiv, { childList: true, subtree: true });
    }

    function tryInject(el) {
      // Already showing our results? Skip.
      if (el.querySelector('.sku-results')) return;
      // No empty state? Native search has results, don't interfere.
      if (!el.querySelector('[class*="empty-state"]')) return;
      // Inject: pause observer, replace content, resume observer
      if (observer) observer.disconnect();
      el.innerHTML = cachedHTML;
      if (observer) observer.observe(el, { childList: true, subtree: true });
    }

    function disconnectObs() {
      if (observer) { observer.disconnect(); observer = null; }
    }
  }

  /* ═══ Storefront API ═══ */
  function searchBySKU(sku) {
    var gql =
      '{ search(first: 5, query: "' + escGQL(sku) + '", types: PRODUCT) { edges { node { ' +
      '... on Product { title handle vendor featuredImage { url altText } ' +
      'priceRange { minVariantPrice { amount currencyCode } } ' +
      'variants(first: 50) { edges { node { id sku price { amount currencyCode } image { url altText } } } } } } } } }';

    return fetch('https://' + SHOP + '/api/2025-04/graphql.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': TOKEN },
      body: JSON.stringify({ query: gql }),
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) {
        if (data.errors) return [];
        var edges = (data.data && data.data.search && data.data.search.edges) || [];
        return edges.map(function (e) {
          var p = e.node;
          var matched = null;
          var sl = sku.toLowerCase();
          ((p.variants && p.variants.edges) || []).forEach(function (ve) {
            if (!matched && ve.node.sku && ve.node.sku.toLowerCase() === sl) matched = ve.node;
          });
          // Extract numeric variant ID from GID (gid://shopify/ProductVariant/123)
          var variantId = matched && matched.id ? matched.id.split('/').pop() : null;
          // Use variant image if available, fall back to product featured image
          var variantImage = matched && matched.image ? matched.image.url : null;
          return {
            title: p.title, handle: p.handle, vendor: p.vendor,
            image: variantImage || (p.featuredImage && p.featuredImage.url),
            price: matched ? matched.price : (p.priceRange && p.priceRange.minVariantPrice),
            sku: matched ? matched.sku : sku,
            variantId: variantId,
          };
        });
      })
      .catch(function () { return []; });
  }

  /* ═══ Render: Predictive dropdown (matching native theme) ═══ */
  function renderDropdown(items, sku) {
    var html = '<div class="sku-results flex w-full flex-col gap-y-6 md:flex-row">';
    html += '<div class="search__box search__box-products flex-grow order-last md:order-first">';
    html += '<div class="predictive-search-result predictive-search-result--products">';
    html += '<h4 class="h4 predictive-search-result__heading" style="margin-bottom:1rem;">SKU match for \u201C' + esc(sku) + '\u201D</h4>';
    html += '<div class="f-grid f-grid--gap-medium f-grid--row-gap-inherit" style="--f-columns-mobile:2;--f-columns-md:3;--f-columns-xl:5;">';

    items.forEach(function (item) {
      var img = item.image ? item.image + '&width=400' : '';
      var href = '/products/' + esc(item.handle) + (item.variantId ? '?variant=' + esc(item.variantId) : '');
      html +=
        '<div class="f-column">' +
        '<div class="product-card product-card-style-standard color-inherit">' +
        '<div class="product-card__wrapper h-full">' +
        '<a href="' + href + '" style="text-decoration:none;color:inherit;display:block;">' +
        '<div class="product-card__image-wrapper" style="aspect-ratio:1/1;overflow:hidden;border-radius:var(--card-radius,8px);margin-bottom:0.625rem;background:var(--color-background-secondary,#f5f5f5);">' +
        (img ? '<img src="' + esc(img) + '" alt="' + esc(item.title) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;">' :
          '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#ccc;">No image</div>') +
        '</div>' +
        '<p class="product-card__title" style="margin:0;font-size:15px;font-weight:400;line-height:24px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + esc(item.title) + '</p>' +
        '</a></div></div></div>';
    });

    html += '</div></div></div></div>';
    return html;
  }

  /* ═══ Render: Search page cards ═══ */
  function renderPageCards(items, sku) {
    var h = '<div class="text-center" style="margin-bottom:1.5rem;">' +
      '<p style="margin:0;color:#666;">Found by SKU match for \u201C<strong>' + esc(sku) + '</strong>\u201D</p></div>';
    var cards = items.map(function (item) {
      var img = item.image ? item.image + '&width=400' : '';
      var href = '/products/' + esc(item.handle) + (item.variantId ? '?variant=' + esc(item.variantId) : '');
      return '<div class="f-column card"><div style="text-align:center;">' +
        '<a href="' + href + '" style="text-decoration:none;color:inherit;display:block;">' +
        (img ? '<div style="margin-bottom:0.75rem;aspect-ratio:1/1;overflow:hidden;border-radius:8px;background:#f5f5f5;">' +
          '<img src="' + esc(img) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;"></div>' : '') +
        '<h3 style="font-size:15px;margin:0 0 .25rem;">' + esc(item.title) + '</h3>' +
        '<p style="margin:.25rem 0 0;font-size:13px;color:#999;">SKU: ' + esc(item.sku) + '</p>' +
        '</a></div></div>';
    }).join('');
    return h + '<div class="f-grid" style="--f-columns-mobile:2;--f-columns-md:3;--f-columns-xl:4;gap:1.5rem;">' + cards + '</div>';
  }

  function renderNoResults(sku) {
    return '<div class="text-center grid gap-1"><h4>No results found for \u201C' + esc(sku) + '\u201D</h4>' +
      '<p class="m-0">Check the spelling or use a different word or phrase.</p></div>';
  }

  function money(a, c) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(a); }
    catch (e) { return c + ' ' + parseFloat(a).toFixed(2); }
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function escGQL(s) { return s.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n'); }
})();
