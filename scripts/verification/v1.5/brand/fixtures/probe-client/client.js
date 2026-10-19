/**
 * S-B1 brand probe — browser half.
 *
 * Shape-equivalent to `scripts/bundle-lib.mjs#bundleModuleLoader` output: a
 * `window.__ModuleLoader__.load({ id, factory(require) })` registration whose
 * module body runs at materialization and resolves every external through the
 * DSH platform module seed table. The only difference from a generated bundle
 * is that the probe records what it observed instead of rendering the market.
 *
 * The probe answers three questions with runtime evidence:
 *   1. Does a third-party `dsh.client` package resolve
 *      `@deepseek-ai/dsh-client-ui-primitives` (and `react` / `react-dom/client`)?
 *   2. Is the official `FishLogo` component and its exported path/viewBox usable?
 *   3. How does the mark render in the light and dark theme palettes?
 *
 * It never writes to the Host, the profile, or the network.
 */
window.__ModuleLoader__.load({
  id: 'dsh-brand-probe',
  factory: function (require) {
    var probe = {
      probeVersion: 1,
      moduleId: 'dsh-brand-probe',
      startedAt: new Date().toISOString(),
      requires: {},
      render: null,
      measurements: {},
    };
    window.__DSH_BRAND_PROBE__ = probe;

    function attempt(name) {
      try {
        return { ok: true, mod: require(name), error: null };
      } catch (error) {
        return { ok: false, mod: null, error: String((error && error.message) || error).slice(0, 400) };
      }
    }

    // --- 1. module resolution -------------------------------------------------
    var reactAttempt = attempt('react');
    probe.requires.react = reactAttempt.ok
      ? { ok: true, version: reactAttempt.mod.version, hasCreateElement: typeof reactAttempt.mod.createElement === 'function' }
      : { ok: false, error: reactAttempt.error };

    var domAttempt = attempt('react-dom/client');
    probe.requires.reactDomClient = domAttempt.ok
      ? { ok: true, hasCreateRoot: typeof domAttempt.mod.createRoot === 'function' }
      : { ok: false, error: domAttempt.error };

    var primitivesAttempt = attempt('@deepseek-ai/dsh-client-ui-primitives');
    var primitives = primitivesAttempt.mod;
    probe.requires.primitives = primitivesAttempt.ok
      ? {
          ok: true,
          exportCount: Object.keys(primitives).length,
          hasFishLogo: typeof primitives.FishLogo === 'function',
          hasBrandWordmark: typeof primitives.BrandWordmark === 'function',
          pathIsString: typeof primitives.FISH_LOGO_PATH === 'string',
          pathLength: typeof primitives.FISH_LOGO_PATH === 'string' ? primitives.FISH_LOGO_PATH.length : null,
          pathPrefix: typeof primitives.FISH_LOGO_PATH === 'string' ? primitives.FISH_LOGO_PATH.slice(0, 40) : null,
          viewBox: primitives.FISH_LOGO_VIEWBOX
            ? { width: primitives.FISH_LOGO_VIEWBOX.width, height: primitives.FISH_LOGO_VIEWBOX.height }
            : null,
          hasViewBoxExport: typeof primitives.FISH_LOGO_VIEWBOX === 'object' && primitives.FISH_LOGO_VIEWBOX !== null,
        }
      : { ok: false, error: primitivesAttempt.error };

    // Negative control: resolution must not succeed for an unknown specifier.
    var negativeAttempt = attempt('@deepseek-ai/dsh-probe-does-not-exist');
    probe.requires.negativeControl = negativeAttempt.ok
      ? { threw: false, note: 'unknown specifier resolved — resolution is not a real check' }
      : { threw: true, message: negativeAttempt.error };

    // --- 2. render ------------------------------------------------------------
    var React = reactAttempt.ok ? reactAttempt.mod : null;
    var createRoot = domAttempt.ok ? domAttempt.mod.createRoot : null;

    function markHost() {
      return document.getElementById('dsh-brand-probe-mark');
    }

    function buildSwatch() {
      if (!React) return null;
      var FishLogo = primitivesAttempt.ok ? primitives.FishLogo : null;
      var mark = FishLogo
        ? React.createElement(FishLogo, { size: 48, className: 'dsh-brand-probe-logo' })
        : React.createElement('span', { style: { fontSize: '12px' } }, 'FishLogo unavailable');
      return React.createElement(
        'div',
        {
          id: 'dsh-brand-probe-card',
          style: {
            background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
            color: 'var(--dsw-alias-label-primary, #14161a)',
            border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
            borderRadius: '12px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            font: '12px/1.4 system-ui, sans-serif',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          },
        },
        mark,
        React.createElement('span', { id: 'dsh-brand-probe-label' }, 'FishLogo (S-B1 probe)'),
      );
    }

    function mount() {
      try {
        if (!React || !createRoot) {
          probe.render = { ok: false, error: 'react or react-dom/client unavailable' };
          return probe.render;
        }
        var existing = document.getElementById('dsh-brand-probe-root');
        if (existing) existing.remove();
        var container = document.createElement('div');
        container.id = 'dsh-brand-probe-root';
        container.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000;pointer-events:none;';
        var mark = document.createElement('div');
        mark.id = 'dsh-brand-probe-mark';
        container.appendChild(mark);
        document.body.appendChild(container);
        createRoot(mark).render(buildSwatch());
        probe.render = { ok: true, mountedAt: new Date().toISOString() };
      } catch (error) {
        probe.render = { ok: false, error: String((error && error.stack) || error).slice(0, 600) };
      }
      return probe.render;
    }

    // --- 3. measure -----------------------------------------------------------
    async function measure() {
      var mark = markHost();
      var svg = mark ? mark.querySelector('svg') : null;
      var theme = {
        dark: document.body.hasAttribute('data-ds-dark-theme'),
        colorScheme: document.documentElement.style.colorScheme || null,
        themeSource: document.documentElement.getAttribute('data-ds-theme-source') || null,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
      };
      if (!svg) return { theme: theme, svg: null };
      var style = getComputedStyle(svg);
      var rect = svg.getBoundingClientRect();
      var path = svg.querySelector('path');
      var pathData = path ? path.getAttribute('d') || '' : '';
      var pathSha256 = null;
      try {
        var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pathData));
        pathSha256 = Array.prototype.map
          .call(new Uint8Array(digest), function (byte) {
            return byte.toString(16).padStart(2, '0');
          })
          .join('');
      } catch (error) {
        pathSha256 = null;
      }
      var svgInfo = {
        width: svg.getAttribute('width'),
        height: svg.getAttribute('height'),
        viewBox: svg.getAttribute('viewBox'),
        ariaHidden: svg.getAttribute('aria-hidden'),
        fill: svg.getAttribute('fill'),
        pathFill: path ? path.getAttribute('fill') : null,
        pathLength: pathData.length,
        pathPrefix: pathData.slice(0, 40),
        pathSha256: pathSha256,
        computedColor: style.color,
        rect: { width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100 },
      };

      // Rasterize the same SVG standalone (with currentColor resolved to the
      // theme's computed text color) and measure the ink the browser paints.
      var ink = null;
      try {
        var clone = svg.cloneNode(true);
        clone.setAttribute('width', '96');
        clone.setAttribute('height', String((96 * Number(primitives.FISH_LOGO_VIEWBOX.height)) / Number(primitives.FISH_LOGO_VIEWBOX.width)));
        clone.setAttribute('style', 'color:' + style.color);
        var xml = new XMLSerializer().serializeToString(clone);
        var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        var image = new Image();
        await new Promise(function (resolve, reject) {
          image.onload = resolve;
          image.onerror = function () {
            reject(new Error('svg data URI failed to decode'));
          };
          image.src = url;
        });
        var canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = Number(clone.getAttribute('height'));
        var context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        var data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        var count = 0;
        var sum = 0;
        var sumR = 0;
        var sumG = 0;
        var sumB = 0;
        var dark = 0;
        var light = 0;
        for (var i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 8) continue;
          var luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          count += 1;
          sum += luminance;
          sumR += data[i];
          sumG += data[i + 1];
          sumB += data[i + 2];
          if (luminance < 0.5) dark += 1;
          else light += 1;
        }
        ink = count === 0
          ? { painted: false, inkPixels: 0 }
          : {
              painted: true,
              inkPixels: count,
              averageLuminance: Math.round((sum / count) * 10000) / 10000,
              averageRgb: [Math.round(sumR / count), Math.round(sumG / count), Math.round(sumB / count)],
              darkInkPixels: dark,
              lightInkPixels: light,
            };
      } catch (error) {
        ink = { painted: false, error: String((error && error.message) || error).slice(0, 300) };
      }
      return { theme: theme, svg: svgInfo, ink: ink, measuredAt: new Date().toISOString() };
    }

    probe.mount = mount;
    probe.measure = measure;
    window.__DSH_BRAND_PROBE_MOUNT__ = mount;
    window.__DSH_BRAND_PROBE_MEASURE__ = measure;

    // --- exports --------------------------------------------------------------
    function apply() {
      mount();
    }

    return { apply: apply, inject: [] };
  },
});
