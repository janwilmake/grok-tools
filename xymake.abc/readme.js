// Import the index.html content
import indexContent from "./index.html";

// Character mapping for double-struck conversion
const doubleStruckMap = {
  // Uppercase letters
  A: "𝔸",
  B: "𝔹",
  C: "ℂ",
  D: "𝔻",
  E: "𝔼",
  F: "𝔽",
  G: "𝔾",
  H: "ℍ",
  I: "𝕀",
  J: "𝕁",
  K: "𝕂",
  L: "𝕃",
  M: "𝕄",
  N: "ℕ",
  O: "𝕆",
  P: "ℙ",
  Q: "ℚ",
  R: "ℝ",
  S: "𝕊",
  T: "𝕋",
  U: "𝕌",
  V: "𝕍",
  W: "𝕎",
  X: "𝕏",
  Y: "𝕐",
  Z: "ℤ",

  // Lowercase letters
  a: "𝕒",
  b: "𝕓",
  c: "𝕔",
  d: "𝕕",
  e: "𝕖",
  f: "𝕗",
  g: "𝕘",
  h: "𝕙",
  i: "𝕚",
  j: "𝕛",
  k: "𝕜",
  l: "𝕝",
  m: "𝕞",
  n: "𝕟",
  o: "𝕠",
  p: "𝕡",
  q: "𝕢",
  r: "𝕣",
  s: "𝕤",
  t: "𝕥",
  u: "𝕦",
  v: "𝕧",
  w: "𝕨",
  x: "𝕩",
  y: "𝕪",
  z: "𝕫",

  // Numbers
  0: "𝟘",
  1: "𝟙",
  2: "𝟚",
  3: "𝟛",
  4: "𝟜",
  5: "𝟝",
  6: "𝟞",
  7: "𝟟",
  8: "𝟠",
  9: "𝟡",
};

// Convert text to double-struck
function convertToDoubleStruck(text) {
  return text
    .split("")
    .map((char) => {
      return doubleStruckMap[char] || char;
    })
    .join("");
}

// Check if request is from a browser
function isBrowserRequest(request) {
  const userAgent = request.headers.get("user-agent") || "";
  const accept = request.headers.get("accept") || "";

  // Check if user-agent contains common browser identifiers
  const hasBrowserUserAgent = /Mozilla|Chrome|Safari|Firefox|Edge|Opera/i.test(
    userAgent,
  );

  // Check if accept header indicates HTML preference
  const acceptsHtml = accept.includes("text/html");

  return hasBrowserUserAgent && acceptsHtml;
}

export default {
  fetch: (request) => {
    // Get the pathname from the URL
    const url = new URL(request.url);
    const pathname = url.pathname;

    console.log(`Request for: ${pathname}`);

    // Check if request is from a browser
    if (isBrowserRequest(request)) {
      // Return the index.html for browser requests
      return new Response(indexContent, {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "no-cache",
        },
      });
    } else {
      // For non-browser requests, convert pathname to double-struck
      let textToConvert =
        pathname === "/" ? "" : decodeURIComponent(pathname.substring(1));
      const convertedText = convertToDoubleStruck(textToConvert);

      // Return as markdown
      return new Response(
        `# Double-Struck Conversion\n\n**Original**: ${textToConvert}\n\n**Converted**: ${convertedText}`,
        {
          status: 200,
          headers: {
            "Content-Type": "text/markdown",
            "Cache-Control": "no-cache",
          },
        },
      );
    }
  },
};
