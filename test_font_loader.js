const assert = require('node:assert/strict');
const test = require('node:test');

const FontLoader = require('./font-loader.js');

class CacheTestLoader extends FontLoader {
  constructor(installedVersion, installedBundleSha256) {
    super();
    this.testInstalledVersion = installedVersion;
    this.testInstalledBundleSha256 = installedBundleSha256;
    this.savedVersion = null;
  }

  async getInstalledBundleMetadata() {
    return {
      key: 'version',
      value: this.testInstalledVersion,
      bundleSha256: this.testInstalledBundleSha256,
    };
  }

  async loadCatalogFromDB() {
    return { fonts: [{ id: 'cached-font' }] };
  }

  async extractBundle() {}

  async saveCatalog() {}

  async setInstalledVersion(version, versionDate, bundleSha256) {
    this.savedVersion = { version, versionDate, bundleSha256 };
  }
}

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body;
    },
  };
}

function bundleResponse() {
  let delivered = false;
  return {
    ok: true,
    headers: {
      get(name) {
        return name === 'content-length' ? '1' : null;
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            if (delivered) return { done: true };
            delivered = true;
            return { done: false, value: new Uint8Array([1]) };
          },
        };
      },
    },
  };
}

test('load downloads a changed bundle when its version is unchanged', async (t) => {
  const requested = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url) => {
    requested.push(url);
    if (url.endsWith('/manifest.json')) {
      return jsonResponse({
        version: 7,
        version_date: '2026-08-23T00:00:00Z',
        bundle_size: 1,
        bundle_sha256: 'new-sha',
      });
    }
    if (url.endsWith('/fonts.json')) {
      return jsonResponse({ fonts: [] });
    }
    return bundleResponse();
  };

  const loader = new CacheTestLoader(7, 'old-sha');

  assert.equal(await loader.load('/bundle'), true);
  assert.deepEqual(requested, [
    '/bundle/manifest.json',
    '/bundle/fonts.json',
    '/bundle/fonts.zip',
  ]);
  assert.deepEqual(loader.savedVersion, {
    version: 7,
    versionDate: '2026-08-23T00:00:00Z',
    bundleSha256: 'new-sha',
  });
});

test('load reuses cache when both version and bundle hash match', async (t) => {
  const requested = [];
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url) => {
    requested.push(url);
    return jsonResponse({ version: 7, bundle_sha256: 'same-sha' });
  };

  const loader = new CacheTestLoader(7, 'same-sha');

  assert.equal(await loader.load('/bundle'), false);
  assert.deepEqual(requested, ['/bundle/manifest.json']);
  assert.deepEqual(loader.getAllFonts(), [{ id: 'cached-font' }]);
});
