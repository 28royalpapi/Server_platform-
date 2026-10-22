export function normalizePhone(value) {
 if (typeof value !== "string") return "";
 const clean = value.trim().replace(/[\s().-]/g, "");
 if (/^\+2340[0-9]{10}$/.test(clean)) {
  const normalized = "+234" + clean.slice(5);
  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : "";
 }
 const digits = clean.replace(/\D/g, "");
 if (/^0[0-9]{10}$/.test(digits)) {
  const normalized = "+234" + digits.slice(1);
  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : "";
 }
 if (/^234[0-9]{10}$/.test(digits)) return "+" + digits;
 if (/^[789][0-9]{9}$/.test(digits)) return "+234" + digits;
 return /^\+[1-9][0-9]{7,14}$/.test(clean) ? clean : "";
}
