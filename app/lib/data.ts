import postgres from 'postgres';
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  Revenue,
} from './definitions';
import { formatCurrency } from './utils';


if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL is not set in environment variables.');
}

export const sql = postgres(process.env.POSTGRES_URL!, {
  ssl: {
    rejectUnauthorized: false, 
  },
  max: 10, 
});


export async function fetchRevenue() {
  try {
    const data = await sql<Revenue[]>`
      SELECT * FROM revenue ORDER BY month ASC
    `;
    return data;
  } catch (error) {
    console.error('Database Error (fetchRevenue):', error);
    return [];
  }
}


export async function fetchLatestInvoices() {
  try {
    const rows = await sql<LatestInvoiceRaw[]>`
      SELECT invoices.amount, customers.name, customers.image_url, customers.email, invoices.id
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      ORDER BY invoices.date DESC
      LIMIT 5
    `;

    return rows.map((invoice) => ({
      ...invoice,
      amount: formatCurrency(invoice.amount),
    }));
  } catch (error) {
    console.error('Database Error (fetchLatestInvoices):', error);
    return [];
  }
}


export async function fetchCardData() {
  try {
    const [invoiceCount, customerCount, totals] = await Promise.all([
      sql`SELECT COUNT(*) AS count FROM invoices`,
      sql`SELECT COUNT(*) AS count FROM customers`,
      sql`
        SELECT
          SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS paid,
          SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS pending
        FROM invoices
      `,
    ]);

    return {
      numberOfInvoices: Number(invoiceCount[0].count ?? 0),
      numberOfCustomers: Number(customerCount[0].count ?? 0),
      totalPaidInvoices: formatCurrency(totals[0].paid ?? 0),
      totalPendingInvoices: formatCurrency(totals[0].pending ?? 0),
    };
  } catch (error) {
    console.error('Database Error (fetchCardData):', error);
    return {
      numberOfInvoices: 0,
      numberOfCustomers: 0,
      totalPaidInvoices: '₱0',
      totalPendingInvoices: '₱0',
    };
  }
}


const ITEMS_PER_PAGE = 6;

export async function fetchFilteredInvoices(query: string, currentPage: number) {
  try {
    const offset = (currentPage - 1) * ITEMS_PER_PAGE;
    const rows = await sql<InvoicesTable[]>`
      SELECT invoices.id, invoices.amount, invoices.date, invoices.status,
             customers.name, customers.email, customers.image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`} OR
        invoices.amount::text ILIKE ${`%${query}%`} OR
        invoices.date::text ILIKE ${`%${query}%`} OR
        invoices.status ILIKE ${`%${query}%`}
      ORDER BY invoices.date DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;
    return rows;
  } catch (error) {
    console.error('Database Error (fetchFilteredInvoices):', error);
    return [];
  }
}

export async function fetchInvoicesPages(query: string) {
  try {
    const data = await sql`
      SELECT COUNT(*) AS count
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`} OR
        invoices.amount::text ILIKE ${`%${query}%`} OR
        invoices.date::text ILIKE ${`%${query}%`} OR
        invoices.status ILIKE ${`%${query}%`}
    `;
    return Math.ceil(Number(data[0].count) / ITEMS_PER_PAGE);
  } catch (error) {
    console.error('Database Error (fetchInvoicesPages):', error);
    return 1;
  }
}


export async function fetchInvoiceById(id: string) {
  try {
    const rows = await sql<InvoiceForm[]>`
      SELECT id, customer_id, amount, status
      FROM invoices
      WHERE id = ${id}
    `;
    if (!rows.length) return null;

    return {
      ...rows[0],
      amount: rows[0].amount / 100, 
    };
  } catch (error) {
    console.error('Database Error (fetchInvoiceById):', error);
    return null;
  }
}


export async function fetchCustomers() {
  try {
    return await sql<CustomerField[]>`
      SELECT id, name
      FROM customers
      ORDER BY name ASC
    `;
  } catch (error) {
    console.error('Database Error (fetchCustomers):', error);
    return [];
  }
}

export async function fetchFilteredCustomers(query: string) {
  try {
    const rows = await sql<CustomersTableType[]>`
      SELECT
        customers.id,
        customers.name,
        customers.email,
        customers.image_url,
        COUNT(invoices.id) AS total_invoices,
        SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
        SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
      FROM customers
      LEFT JOIN invoices ON customers.id = invoices.customer_id
      WHERE
        customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`}
      GROUP BY customers.id, customers.name, customers.email, customers.image_url
      ORDER BY customers.name ASC
    `;

    return rows.map((customer) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));
  } catch (error) {
    console.error('Database Error (fetchFilteredCustomers):', error);
    return [];
  }
}
