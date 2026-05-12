import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/config/auth-thresholds
router.get('/auth-thresholds', authenticate, (req, res) => {
  res.json({
    // Thresholds for each currency (500K in each currency)
    thresholds: {
      PHP: { vp: 500000, president: 500000 }, // ₱500K
      USD: { vp: 500000, president: 500000 }, // $500K
      IDR: { vp: 500000, president: 500000 }  // Rp500K
    },
    // Exchange rates for conversion reference (base: PHP)
    exchange_rates: {
      PHP: 1,
      USD: 0.018,  // 1 PHP = 0.018 USD (~₱56 per $1)
      IDR: 291     // 1 PHP = ~291 IDR (~Rp16,300 per $1)
    },
    default_currency: 'PHP'
  });
});

export default router;
