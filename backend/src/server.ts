import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import requestRoutes from './routes/requests';
import departmentRoutes from './routes/departments';
import expenseRoutes from './routes/expenses';
import pettyCashRoutes from './routes/pettyCash';
import reportRoutes from './routes/reports';
import projectRoutes from './routes/projects';
import vendorRoutes from './routes/vendors';
import slaRoutes from './routes/sla';
import budgetAlertRoutes from './routes/budgetAlerts';

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/petty-cash', pettyCashRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/sla', slaRoutes);
app.use('/api/budget-alerts', budgetAlertRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});