
import { GoogleGenAI, Type } from "@google/genai";
import { Product, GeminiModelId, AiInstructions } from "../types";

// Default model if not specified
const DEFAULT_MODEL = "gemini-2.5-flash";
// Use gemini-2.0-flash for research with Google Search (2.5-pro has issues)
const RESEARCH_MODEL = "gemini-2.0-flash";

export const testConnection = async (apiKey: string, model?: GeminiModelId): Promise<boolean> => {
  if (!apiKey) return false;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: model || DEFAULT_MODEL,
      contents: "Hello, respond with 'OK'",
    });
    return response.text?.includes("OK") || response.text?.length > 0 || false;
  } catch (e) {
    console.error("Gemini test failed", e);
    return false;
  }
};

// ============ PRODUCT RESEARCH ============
export const researchProduct = async (
  apiKey: string,
  name: string,
  ean: string,
  model?: GeminiModelId,
  customPrompt?: string
): Promise<string> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  
  const basePrompt = customPrompt || `Wyszukaj szczegółowe informacje o produkcie.
Znajdź oficjalną nazwę, markę, model, specyfikacje techniczne.
Znajdź kluczowe cechy i zalety produktu.
Użyj Google Search do znalezienia oficjalnych źródeł.`;

  const prompt = `${basePrompt}

Product: "${name}"
EAN: ${ean || 'brak'}

Zwróć szczegółowy raport o produkcie zawierający:
- Pełna oficjalna nazwa produktu
- Marka i model
- Specyfikacje techniczne (wymiary, waga, materiały, funkcje)
- Zawartość zestawu
- Kluczowe cechy i zalety
- Słowa kluczowe dla SEO`;

  const response = await ai.models.generateContent({
    model: model || RESEARCH_MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }]
    }
  });

  return response.text || "";
};

export const fetchCompetitionData = async (
  apiKey: string,
  product: Product,
  model?: GeminiModelId,
  customPrompt?: string
): Promise<{ minTotal: number; medianTotal: number; warnings: string[] }> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  
  const basePrompt = customPrompt || `Szukaj aktualnych ofert na eBay.de dla podanego produktu.
Najpierw szukaj po EAN, potem po nazwie.
Znajdź cenę łączną (produkt + wysyłka do Niemiec).
Ignoruj oferty z dostawą >7 dni.`;

  const prompt = `${basePrompt}

Product: "${product.inputName}" (EAN: ${product.ean})

Return ONLY a JSON object with keys: minTotal (number), medianTotal (number), warnings (array of strings).`;

  const response = await ai.models.generateContent({
    model: model || DEFAULT_MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          minTotal: { type: Type.NUMBER },
          medianTotal: { type: Type.NUMBER },
          warnings: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["minTotal", "medianTotal", "warnings"]
      }
    }
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to parse competition data", e);
    throw new Error("Failed to analyze competition data.");
  }
};

export const generateProductTitle = async (
  apiKey: string,
  name: string,
  ean: string,
  instructions: string,
  model?: GeminiModelId
): Promise<string> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model || DEFAULT_MODEL,
    contents: `Generate only a professional eBay listing title for this product.
               Input Name: ${name}
               EAN: ${ean}
               Instructions: ${instructions}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING }
        },
        required: ["title"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || "{}");
    return data.title || "";
  } catch (e) {
    console.error("Failed to parse AI title response", e);
    throw new Error("AI returned invalid title formatting.");
  }
};

export const generateProductDetails = async (
  apiKey: string, 
  name: string, 
  ean: string, 
  instructions: string,
  model?: GeminiModelId,
  titlePrompt?: string,
  descriptionPrompt?: string,
  researchData?: string
): Promise<Partial<Product>> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  
  const researchSection = researchData 
    ? `\n\n=== WYNIKI BADAŃ PRODUKTU ===\n${researchData}\n=== KONIEC BADAŃ ===\n\nWykorzystaj powyższe informacje z badań do stworzenia bogatego, szczegółowego opisu.\n`
    : '';
  
  const prompt = `${titlePrompt || 'Generuj profesjonalne tytuły do aukcji eBay.de w języku niemieckim.'}

${descriptionPrompt || 'Generuj opisy produktów dla eBay.de w HTML. Język niemiecki, profesjonalny ton.'}
${researchSection}
Product Name: ${name}
EAN: ${ean}
Additional Rules: ${instructions}

Generate SKU, Title (max 80 chars, German), Description (HTML, German with detailed features from research), Keywords, and suggested price.`;

  const response = await ai.models.generateContent({
    model: model || DEFAULT_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sku: { type: Type.STRING },
          title: { type: Type.STRING },
          descriptionHtml: { type: Type.STRING },
          keywords: { type: Type.STRING },
          suggestedPrice: { type: Type.NUMBER }
        },
        required: ["sku", "title", "descriptionHtml", "keywords", "suggestedPrice"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || "{}");
    return data;
  } catch (e) {
    console.error("Failed to parse AI response", e);
    throw new Error("AI returned invalid JSON formatting.");
  }
};

// Pełny pipeline: research + generowanie
export const generateProductWithResearch = async (
  apiKey: string,
  name: string,
  ean: string,
  instructions: string,
  options: {
    useResearch?: boolean;
    researchModel?: GeminiModelId;
    researchPrompt?: string;
    generateModel?: GeminiModelId;
    titlePrompt?: string;
    descriptionPrompt?: string;
    companyBanner?: string;  // Firmowy baner do dołączenia
  } = {}
): Promise<Partial<Product> & { researchReport?: string }> => {
  let researchData: string | undefined;
  
  // Krok 1: Research (jeśli włączony)
  if (options.useResearch) {
    try {
      console.log('🔍 Starting product research...');
      researchData = await researchProduct(
        apiKey,
        name,
        ean,
        options.researchModel,
        options.researchPrompt
      );
      console.log('✅ Research completed');
    } catch (error) {
      console.warn('⚠️ Research failed, continuing without:', error);
    }
  }
  
  // Krok 2: Generowanie tytułu i opisu
  console.log('📝 Generating product details...');
  const productDetails = await generateProductDetails(
    apiKey,
    name,
    ean,
    instructions,
    options.generateModel,
    options.titlePrompt,
    options.descriptionPrompt,
    researchData
  );
  
  // Note: Company banner is added at display/export time, not during generation
  // This prevents duplicate banners when regenerating descriptions
  
  return {
    ...productDetails,
    researchReport: researchData
  };
};

export const suggestCategory = async (
  apiKey: string,
  name: string,
  model?: GeminiModelId,
  customPrompt?: string
): Promise<{ id: string; name: string; confidence: string }[]> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  
  // Common eBay.de category IDs
  const categoryReference = `
Wichtige eBay.de Kategorien:
- Kopfhörer/Headsets: 112529
- Handys/Smartphones: 9355
- Smartwatches: 178893
- Tablets: 171485
- Laptops/Notebooks: 177
- Lautsprecher: 14990
- HiFi/Audio: 3276
- TV/Fernseher: 48458
- Spielkonsolen: 139971
- Videospiele: 139973
- Küchengeräte: 20657
- Staubsauger: 20614
- Kaffeemaschinen: 38250
- Fitness: 15273
- LEGO: 19006
- Spielzeug: 220
`;

  const prompt = `Du bist eBay.de Kategorisierungsexperte.
${categoryReference}

Produkt: "${name}"

Finde die passendste eBay.de Kategorie-ID.
Antworte NUR mit JSON Array: [{"id": "NUMMER", "name": "Kategoriename", "confidence": "TOP1"}]
Beispiel: [{"id": "112529", "name": "Kopfhörer", "confidence": "TOP1"}]`;

  try {
    const response = await ai.models.generateContent({
      model: model || DEFAULT_MODEL,
      contents: prompt
    });

    const text = response.text || "[]";
    console.log('📂 Category raw response:', text);
    
    // Try to extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const categories = JSON.parse(jsonMatch[0]);
      console.log('📂 Found categories:', categories);
      return categories;
    }
    
    return [];
  } catch (e) {
    console.error("Failed to get category:", e);
    return [];
  }
};
