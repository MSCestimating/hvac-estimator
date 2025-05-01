function extractHVACDetails(text) {
  // Normalize text for consistent matching
  const cleanText = text.toUpperCase();

  // Expanded equipment detection
  const equipmentTags = [
    ...cleanText.matchAll(/\b(RTU|EF|FCU|VAV|AHU|DOAS|MAU|ACU|HP|COND|CTRL|BMS|FD|SD|OA|EX|E|O)?[-\s]?\d+\b/g),
    ...cleanText.matchAll(/\b(RTU|EF|FCU|VAV|AHU|DOAS|MAU|ACU|HP|COND|CTRL|BMS|FD|SD|OA|EX|E|O)\b/g) // include tag-only
  ].map(m => m[0]);

  const equipmentCounts = equipmentTags.reduce((acc, rawTag) => {
    const key = rawTag.split(/[-\s]/)[0].replace(/[^A-Z]/g, '').toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Pipe size detection
  const pipeSizes = [...text.matchAll(/(\d{1,2}(-\d\/\d)?|\d\/\d)?\s?\"?\s?(GAS|DRYER|COND|CW|VTR|HW|HWS|CHW)/gi)].map(m => ({
    size: normalizeFractionalSize(m[1]),
    type: m[3]?.toUpperCase()
  }));

  const pipingCounts = pipeSizes.reduce((acc, cur) => {
    const key = `${cur.size || '?"'} ${cur.type}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  // Air distribution components
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

  // Duct sizes (e.g., 18x12)
  const deviceSizes = [...cleanText.matchAll(/\b(\d{1,3})\s?[x×X]\s?(\d{1,3})\b/g)].map(m => `${m[1]}x${m[2]}`);
  const sizeCounts = deviceSizes.reduce((acc, sz) => {
    acc[sz] = (acc[sz] || 0) + 1;
    return acc;
  }, {});

  // Duct & pipe length detection
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
