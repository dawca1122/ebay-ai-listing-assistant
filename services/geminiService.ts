
import { GoogleGenAI, Type } from "@google/genai";
import { Product, GeminiModelId, AiInstructions } from "../types";

// Default model if not specified
const DEFAULT_MODEL = "gemini-2.5-flash";

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
  descriptionPrompt?: string
): Promise<Partial<Product>> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `${titlePrompt || 'Generuj profesjonalne tytuły do aukcji eBay.de w języku niemieckim.'}

${descriptionPrompt || 'Generuj opisy produktów dla eBay.de w HTML. Język niemiecki, profesjonalny ton.'}

Product Name: ${name}
EAN: ${ean}
Additional Rules: ${instructions}

Generate SKU, Title (max 80 chars, German), Description (HTML, German), Keywords, and suggested price.`;

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

export const suggestCategory = async (
  apiKey: string,
  name: string,
  model?: GeminiModelId,
  customPrompt?: string
): Promise<{ id: string; name: string; confidence: string }[]> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  
  const basePrompt = customPrompt || `Znajdź najlepszą kategorię eBay.de dla produktu.
Zwróć ID kategorii z drzewa 77 (EBAY_DE).
Wybierz najbardziej szczegółową pasującą kategorię.`;

  const response = await ai.models.generateContent({
    model: model || DEFAULT_MODEL,
    contents: `${basePrompt}

Product: "${name}"

Return top 2 eBay categories with ID (number), Name, and confidence label ('TOP1' or 'TOP2').`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            confidence: { type: Type.STRING }
          },
          required: ["id", "name", "confidence"]
        }
      }
    }
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse category response", e);
    return [];
  }
};
