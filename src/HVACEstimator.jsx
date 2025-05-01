function extractHVACDetails(text) {
  const cleanText = text.toUpperCase();

  // 🔧 Strict tag-based equipment detection
  const tagMap = {
    RTU: /\bRTU[-\s]?\d+\b/g,
    VAV: /\bVAV[-\s]?\d+\b/g,
    EF: /\bEF[-\s]?\d+\b/g,
    EXFAN: /\bEX(FAN)?[-\s]?\d+\b/g,
    FCU: /\bFCU[-\s]?\d+\b/g,
    MAU: /\bMAU[-\s]?\d+\b/g,
    DOAS: /\bDOAS[-\s]?\d+\b/g,
    AHU: /\bAHU[-\s]?\d+\b/g,
    HP: /\bHP[-\s]?\d+\b/g,
    COND: /\bCOND[-\s]?\d+\b/g,
    OA: /\b(OA|O)[-\s]?\d+\b/g,
    FD: /\bFD[-\s]?\d+\b/g,
    SD: /\bSD[-\s]?\d+\b/g,
    CTRL: /\b(CTRL|BMS)[-\s]?\d*\b/g
  };

  const equipmentCounts = {};
  for (const [key, regex] of Object.entries(tagMap)) {
    const matches = cleanText.match(regex);
    if (matches) equipmentCounts[key] = matches.length;
  }

  // 📏 Pipe sizes
  const pipeSizes = [...text.matchAll(/(\d{1,2}(-\d\/\d)?|\d\/\d)?\s?\"?\s?(GAS|DRYER|COND|CW|VTR|HW|HWS|CHW)/gi)].map(m => ({
    size: normalizeFractionalSize(m[1]),
    type: m[3]?.toUpperCase()
  }));

  const pipingCounts = pipeSizes.reduce((acc, cur) => {
    const key = `${cur.size || '?"'} ${cur.type}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // 🌬️ Air distribution
  const supplyTags = (cleanText.match(/\bS[-\s]?\d+\b/g) || []).length;
  const returnTags = (cleanText.match(/\bR[-\s]?\d+\b/g) || []).length;
  const diffusers = (cleanText.match(/\b(DIFF[-\s]?\d+|DIFFUSER(S)?|SD)\b/g) || []).length;
  const grilles = (cleanText.match(/\b(GRL|GRILLE(S)?|RG|EG)\b/g) || []).length;
  const registers = (cleanText.match(/\b(REG|REGISTER(S)?)\b/g) || []).length;

  const airDist = {
    supplyTags,
    returnTags,
    diffusers,
    grilles,
    registers,
    supplyTotal: supplyTags + diffusers,
    returnTotal: returnTags + grilles + registers
  };

  // 📐 Device sizes
  const deviceSizes = [...cleanText.matchAll(/\b(\d{1,3})\s?[x×X]\s?(\d{1,3})\b/g)].map(m => `${m[1]}x${m[2]}`);
  const sizeCounts = deviceSizes.reduce((acc, sz) => {
    acc[sz] = (acc[sz] || 0) + 1;
    return acc;
  }, {});

  // 📏 Duct & Pipe Lengths
  const ductMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?(DUCT)\b/g)].map(m => parseInt(m[1]));
  const pipeMentions = [...cleanText.matchAll(/\b(\d{1,4})\s?(?:'|FT|FEET)\b[^\n]*?(PIPE)\b/g)].map(m => parseInt(m[1]));

  return {
    equipmentCounts,
    airDist,
    pipingCounts,
    sizeCounts,
    ductLength: ductMentions.reduce((a, b) => a + b, 0),
    pipeLength: pipeMentions.reduce((a, b) => a + b, 0)
  };
}
export default HVACEstimator;

