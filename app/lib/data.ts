import { sql } from '@vercel/postgres';
import { unstable_noStore as noStore } from 'next/cache';
const { Pool } = require('pg');
const pool = new Pool({
    user: 'golu',
    password: 'golu',
    host: 'localhost',
    port: '5432',
    database: 'verceldb',
});
import { formatCurrency } from './utils';

export async function fetchRevenue() {
  // Add noStore() here to prevent the response from being cached.
  // This is equivalent to in fetch(..., {cache: 'no-store'}).
  noStore();
  const client = await pool.connect();
  try {
    console.log('fetching revenue.....');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const query = 'SELECT * FROM revenue';
    const { rows } = await client.query(query);

    console.log('Data fetched successfully after 3 seconds.');
    return rows;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch revenue data.');
  } finally {
    client.release();
  }
}

export async function fetchLatestInvoices() {
  noStore();
  const client = await pool.connect();
  try {
    const query = `SELECT invoices.amount, customers.name, customers.image_url, customers.email, invoices.id
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      ORDER BY invoices.date DESC
      LIMIT 5`;
    const { rows } = await client.query(query);

    const latestInvoices = rows.map((invoice: { amount: number; }) => ({
      ...invoice,
      amount: formatCurrency(invoice.amount),
    }));
    return latestInvoices;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch the latest invoices.');
  } finally {
    client.release();
  }
}

export async function fetchCardData() {
  noStore();
  const client = await pool.connect();
  try {
    const [invoiceCountResult, customerCountResult, invoiceStatusResult] = await Promise.all([
      client.query('SELECT COUNT(*) FROM invoices'),
      client.query('SELECT COUNT(*) FROM customers'),
      client.query(`
        SELECT
          SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS "paid",
          SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS "pending"
        FROM invoices
      `)
    ]);

    const numberOfInvoices = Number(invoiceCountResult.rows[0].count || '0');
    const numberOfCustomers = Number(customerCountResult.rows[0].count || '0');
    const totalPaidInvoices = formatCurrency(invoiceStatusResult.rows[0].paid || '0');
    const totalPendingInvoices = formatCurrency(invoiceStatusResult.rows[0].pending || '0');

    return {
      numberOfCustomers,
      numberOfInvoices,
      totalPaidInvoices,
      totalPendingInvoices,
    };
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch card data.');
  } finally {
    client.release();
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number,
) {
  noStore();
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;
  const client = await pool.connect();
  try {
    const sqlQuery = `
      SELECT
        invoices.id,
        invoices.amount,
        invoices.date,
        invoices.status,
        customers.name,
        customers.email,
        customers.image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE $1 OR
        customers.email ILIKE $1 OR
        invoices.amount::text ILIKE $1 OR
        invoices.date::text ILIKE $1 OR
        invoices.status ILIKE $1
      ORDER BY invoices.date DESC
      LIMIT $2 OFFSET $3
    `;

    const { rows } = await client.query(sqlQuery, [`%${query}%`, ITEMS_PER_PAGE, offset]);
    return rows;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoices.');
  } finally {
    client.release();
  }
}

export async function fetchInvoicesPages(query: string) {
  noStore();
  const client = await pool.connect();
  try {
    const sqlQuery = `
      SELECT COUNT(*)
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE $1 OR
        customers.email ILIKE $1 OR
        invoices.amount::text ILIKE $1 OR
        invoices.date::text ILIKE $1 OR
        invoices.status ILIKE $1
    `;

    const countResult = await client.query(sqlQuery, [`%${query}%`]);
    const totalInvoices = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalInvoices / ITEMS_PER_PAGE);
    return totalPages;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch total number of invoices.');
  } finally {
    client.release();
  }
}

export async function fetchInvoiceById(id: string) {
  noStore();
  const client = await pool.connect();
  try {
    const sqlQuery = `
      SELECT
        invoices.id,
        invoices.customer_id,
        invoices.amount,
        invoices.status
      FROM invoices
      WHERE invoices.id = $1
    `;
    
    const { rows } = await client.query(sqlQuery, [id]);

    if (rows.length === 0) {
      throw new Error('Invoice not found.');
    }

    // Convert amount from cents to dollars
    const invoice = {
      ...rows[0],
      amount: rows[0].amount / 100
    };

    return invoice;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoice.');
  } finally {
    client.release();
  }
}

export async function fetchCustomers() {
  const client = await pool.connect();
  try {
    const sqlQuery = `
      SELECT
        id,
        name
      FROM customers
      ORDER BY name ASC
    `;
    
    const { rows } = await client.query(sqlQuery);
    return rows;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch all customers.');
  } finally {
    client.release();
  }
}

export async function fetchFilteredCustomers(query: string) {
  noStore();
  const client = await pool.connect();
  try {
    const sqlQuery = `
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
        customers.name ILIKE $1 OR
        customers.email ILIKE $1
      GROUP BY customers.id, customers.name, customers.email, customers.image_url
      ORDER BY customers.name ASC
    `;

    const { rows } = await client.query(sqlQuery, [`%${query}%`]);

    const customers = rows.map((customer: { total_pending: number; total_paid: number; }) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));

    return customers;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch customer table.');
  } finally {
    client.release();
  }
}

export async function getUser(email: string) {
  const client = await pool.connect();
  try {
    const sqlQuery = 'SELECT * FROM users WHERE email = $1';
    const { rows } = await client.query(sqlQuery, [email]);
    
    if (rows.length === 0) {
      throw new Error('User not found.');
    }

    return rows[0];
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  } finally {
    client.release();
  }
}
