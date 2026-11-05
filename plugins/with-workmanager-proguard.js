const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

const WORK_DATABASE_KEEP_RULE =
  '-keep class androidx.work.impl.WorkDatabase_Impl { public <init>(); }';

module.exports = function withWorkManagerProguard(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const rulesPath = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro',
      );
      const rules = fs.existsSync(rulesPath)
        ? fs.readFileSync(rulesPath, 'utf8')
        : '';

      if (!rules.split(/\r?\n/).includes(WORK_DATABASE_KEEP_RULE)) {
        fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
        fs.appendFileSync(
          rulesPath,
          `${rules && !rules.endsWith('\n') ? '\n' : ''}${WORK_DATABASE_KEEP_RULE}\n`,
        );
      }

      return config;
    },
  ]);
};
