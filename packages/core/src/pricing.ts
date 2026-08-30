export interface CreditPack {
  id: string;
  credits: number;
  priceMinorUnits: number;
  currencyCode: string;
}

export function formatMinorUnits(amount: number, currencyCode: string): string {
  const major = amount / 100;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
  }).format(major);
}
