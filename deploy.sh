#!/bin/bash

echo "🚀 Deploying Madison88 Budget Management System to Netlify"
echo "=========================================================="

# Check if Netlify CLI is installed
if ! command -v netlify &> /dev/null; then
    echo "❌ Netlify CLI not found. Install it first:"
    echo "npm install -g netlify-cli"
    exit 1
fi

# Check if user is logged in
if ! netlify status &> /dev/null; then
    echo "❌ Not logged in to Netlify. Run:"
    echo "netlify login"
    exit 1
fi

# Build the frontend
echo "📦 Building frontend..."
cd frontend
npm run build
cd ..

# Deploy to Netlify
echo "🌐 Deploying to Netlify..."
netlify deploy --prod --dir=frontend/dist

echo "✅ Deployment complete!"
echo "🔗 Your site should be live at the Netlify URL shown above"
echo ""
echo "📋 Next steps:"
echo "1. Set environment variables in Netlify dashboard:"
echo "   - SUPABASE_URL"
echo "   - SUPABASE_ANON_KEY"
echo "   - JWT_SECRET"
echo "   - SMTP_HOST"
echo "   - SMTP_PORT"
echo "   - SMTP_SECURE"
echo "   - SMTP_USER"
echo "   - SMTP_PASS"
echo "   - EMAIL_FROM"
echo "2. Run database schema and seed data in Supabase dashboard"
echo "3. Test the application!"
