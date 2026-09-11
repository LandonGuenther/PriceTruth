export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface BestBuyProductInfo {
  priceCents: number;
  referencePriceCents: number | null;
  title: string | null;
  brand: string | null;
  modelNumber: string | null;
  gtin: string | null;
  inStock: boolean | null;
}

interface BestBuyApiProduct {
  sku?: number;
  name?: string;
  salePrice?: number;
  regularPrice?: number;
  onlineAvailability?: boolean;
  upc?: string;
  manufacturer?: string;
  modelNumber?: string;
}

/**
 * Fetch a product from the official Best Buy Products API.
 * Returns null on any failure — enrichment never fails the request.
 */
export async function fetchBestBuyProduct(
  sku: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<BestBuyProductInfo | null> {
  // Defense in depth (also enforced by the observation schema): never build a
  // URL from anything but a bare numeric SKU — fixed host, no path traversal.
  if (!/^\d{1,12}$/.test(sku)) return null;
  const url =
    `https://api.bestbuy.com/v1/products(sku=${encodeURIComponent(sku)})` +
    `?apiKey=${encodeURIComponent(apiKey)}&format=json` +
    `&show=sku,name,salePrice,regularPrice,onlineAvailability,upc,manufacturer,modelNumber`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const product = (await res.json()) as BestBuyApiProduct;
    if (typeof product.salePrice !== "number" || product.salePrice <= 0) return null;

    // The API returns JSON numbers (e.g. 299.99), not text — Math.round(x * 100)
    // is acceptable here and only here; page-scraped text must go through
    // parsePriceToCents instead.
    const priceCents = Math.round(product.salePrice * 100);
    const referencePriceCents =
      typeof product.regularPrice === "number" && product.regularPrice > product.salePrice
        ? Math.round(product.regularPrice * 100)
        : null;

    return {
      priceCents,
      referencePriceCents,
      title: product.name ?? null,
      brand: product.manufacturer ?? null,
      modelNumber: product.modelNumber ?? null,
      gtin: product.upc ?? null,
      inStock: typeof product.onlineAvailability === "boolean" ? product.onlineAvailability : null,
    };
  } catch {
    return null;
  }
}
