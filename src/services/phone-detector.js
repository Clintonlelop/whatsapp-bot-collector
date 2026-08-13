function detectPhoneNumbers(text) {
  const phoneNumbers = [];
  
  // Normalize Unicode characters that might break regex matching
  const normalizedText = text
    // Convert Unicode dashes to regular hyphens
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    // Convert non-breaking spaces and other Unicode spaces to regular spaces
    .replace(/[\u00A0\u202F\u2009\u200A]/g, ' ')
    // Remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Normalize any other problematic characters
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"');
  
  // Enhanced phone number regex patterns
  const patterns = [
    // US format: +1 (555) 123-4567, +1-555-123-4567, +1.555.123.4567
    /\+1[-.\s]?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g,
    // US format: (555) 123-4567, 555-123-4567, 555.123.4567
    /\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g,
    // International format: +XX XXX XXX XXXX
    /\+([0-9]{1,3})[-.\s]?([0-9]{3,4})[-.\s]?([0-9]{3,4})[-.\s]?([0-9]{3,4})/g,
    // Simple 10-digit: 5551234567
    /\b([0-9]{10})\b/g,
    // Simple 11-digit: 15551234567
    /\b(1[0-9]{10})\b/g,
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      let number = match[0];
      
      // Clean up the number
      number = number.replace(/[-.\s()]/g, '');
      
      // Add +1 prefix if it's a 10-digit US number
      if (number.length === 10 && /^[2-9]/.test(number)) {
        number = '+1' + number;
      } else if (number.length === 11 && number.startsWith('1')) {
        number = '+' + number;
      } else if (!number.startsWith('+')) {
        number = '+' + number;
      }
      
      // Validate phone number length (7-15 digits after country code)
      const digitsOnly = number.replace(/^\+/, '');
      if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
        phoneNumbers.push(number);
      }
    }
    // Reset regex lastIndex
    pattern.lastIndex = 0;
  });

  // Remove duplicates and return
  return Array.from(new Set(phoneNumbers));
}

function formatPhoneNumber(phoneNumber) {
  // Remove all non-digit characters except +
  const cleaned = phoneNumber.replace(/[^\d+]/g, '');
  
  // Format US numbers
  if (cleaned.startsWith('+1') && cleaned.length === 12) {
    const digits = cleaned.substring(2);
    return `+1 (${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
  }
  
  // For other international numbers, keep as is
  return cleaned;
}

module.exports = {
  detectPhoneNumbers,
  formatPhoneNumber,
};
