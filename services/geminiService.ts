
import { GoogleGenAI, Type } from "@google/genai";
import { Product } from "../types";

export const testConnection = async (apiKey: string): Promise<boolean> => {
  if (!apiKey) return false;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Hello, respond with 'OK'",
    });
    return response.text?.includes("OK") || false;
  } catch (e) {
    console.error("Gemini test failed", e);
    return false;
  }
};

export const fetchCompetitionData = async (
  apiKey: string,
  product: Product
): Promise<{ minTotal: number; medianTotal: number; warnings: string[] }> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Find current real listings on eBay.de for product: "${product.inputName}" (EAN: ${product.ean}).
                  Focus on eBay.de. Search by EAN first, then by title.
                  Identify the total price (item + shipping to Germany).
                  Calculate:
                  1. The minimum total price found.
                  2. The median total price.
                  3. Note any delivery times longer than 5 days or extreme price outliers as warnings.
                  
                  Return ONLY a JSON object with keys: minTotal, medianTotal, warnings (array of strings).`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
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
  instructions: string
): Promise<string> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
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
  instructions: string
): Promise<Partial<Product>> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate professional eBay listing data.
               Product Name: ${name}
               EAN: ${ean}
               Specific Rules: ${instructions}`,
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
  name: string
): Promise<{ id: string; name: string; confidence: string }[]> => {
  if (!apiKey) throw new Error("Missing Gemini API Key");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Suggest the top 2 eBay categories (ID and Name) for the product: "${name}". 
               Respond with confidence label as 'TOP1' or 'TOP2'.`,
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
