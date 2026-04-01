const yaml = require('js-yaml');
const fs = require('fs');
try {
  const data = yaml.load(fs.readFileSync('./backend/contracts/templates/asset_kaufvertrag.yaml', 'utf8'));
  console.log('✓ YAML valid');
  console.log('  Keys:', Object.keys(data).join(', '));
  if (data.variables && data.variables.conditions) {
    console.log('✓ Found', data.variables.conditions.length, 'conditions');
    const newVar = data.variables.conditions.find(v => v.id === 'HAT_FIRMENFORTFUEHRUNG');
    if (newVar) console.log('✓ HAT_FIRMENFORTFUEHRUNG found:', newVar.label);
  }
} catch (e) {
  console.error('✗ YAML ERROR:', e.message);
  console.error('  Location:', e.mark);
  process.exit(1);
}
