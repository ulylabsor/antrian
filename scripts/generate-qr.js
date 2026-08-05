import dotenv from 'dotenv';
import QRCode from 'qrcode';
import fs from 'fs';

dotenv.config();

async function main() {
  const port = process.env.PORT || 3000;
  const url = process.env.APP_URL || `http://localhost:${port}`;

  await QRCode.toFile('qr-code.png', url, {
    width: 400,
    margin: 2,
    color: {
      dark: '#1e40af',
      light: '#ffffff',
    },
  });

  console.log(`QR code generated: qr-code.png`);
  console.log(`URL: ${url}`);
  console.log('Print QR code ini dan tempel di lokasi pengambilan sertifikat.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
