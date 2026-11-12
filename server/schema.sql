--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6 (Homebrew)
-- Dumped by pg_dump version 18.6 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id integer NOT NULL,
    employee_code text NOT NULL,
    full_name text NOT NULL,
    pay_type text NOT NULL,
    pay_rate numeric(12,2) NOT NULL,
    CONSTRAINT employees_pay_rate_check CHECK ((pay_rate > (0)::numeric)),
    CONSTRAINT employees_pay_type_check CHECK ((pay_type = ANY (ARRAY['daily'::text, 'monthly'::text])))
);


--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.employees ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.employees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: payroll_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_items (
    id integer NOT NULL,
    payroll_period_id integer NOT NULL,
    employee_id integer NOT NULL,
    pay_type_used text NOT NULL,
    pay_rate_used numeric(12,2) NOT NULL,
    base_pay numeric(14,2) NOT NULL,
    overtime_15_pay numeric(14,2) NOT NULL,
    overtime_3_pay numeric(14,2) NOT NULL,
    meal_pay numeric(14,2) NOT NULL,
    shift_pay numeric(14,2) NOT NULL,
    gross_pay numeric(14,2) GENERATED ALWAYS AS (((((base_pay + overtime_15_pay) + overtime_3_pay) + meal_pay) + shift_pay)) STORED,
    CONSTRAINT payroll_items_base_pay_check CHECK ((base_pay >= (0)::numeric)),
    CONSTRAINT payroll_items_meal_pay_check CHECK ((meal_pay >= (0)::numeric)),
    CONSTRAINT payroll_items_overtime_15_pay_check CHECK ((overtime_15_pay >= (0)::numeric)),
    CONSTRAINT payroll_items_overtime_3_pay_check CHECK ((overtime_3_pay >= (0)::numeric)),
    CONSTRAINT payroll_items_pay_rate_used_check CHECK ((pay_rate_used > (0)::numeric)),
    CONSTRAINT payroll_items_pay_type_used_check CHECK ((pay_type_used = ANY (ARRAY['daily'::text, 'monthly'::text]))),
    CONSTRAINT payroll_items_shift_pay_check CHECK ((shift_pay >= (0)::numeric))
);


--
-- Name: payroll_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.payroll_items ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.payroll_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: payroll_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_periods (
    id integer NOT NULL,
    period_name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    overtime_start_date date,
    overtime_end_date date,
    payment_date date,
    CONSTRAINT payroll_periods_check CHECK ((end_date >= start_date))
);


--
-- Name: payroll_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.payroll_periods ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.payroll_periods_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: work_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_logs (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    work_date date NOT NULL,
    regular_minutes integer NOT NULL,
    overtime_minutes integer DEFAULT 0 NOT NULL,
    meal_allowance numeric(10,2) DEFAULT 0 NOT NULL,
    shift_type text,
    overtime_3x_minutes integer,
    CONSTRAINT work_logs_check CHECK (((regular_minutes + overtime_minutes) <= 1440)),
    CONSTRAINT work_logs_check1 CHECK (((overtime_3x_minutes >= 0) AND (overtime_3x_minutes <= overtime_minutes))),
    CONSTRAINT work_logs_meal_allowance_check CHECK ((meal_allowance >= (0)::numeric)),
    CONSTRAINT work_logs_overtime_minutes_check CHECK ((overtime_minutes >= 0)),
    CONSTRAINT work_logs_regular_minutes_check CHECK ((regular_minutes >= 0)),
    CONSTRAINT work_logs_shift_type_check CHECK ((shift_type = ANY (ARRAY['day'::text, 'night'::text])))
);


--
-- Name: work_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.work_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.work_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: employees employees_employee_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_employee_code_key UNIQUE (employee_code);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: payroll_items payroll_items_payroll_period_id_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_payroll_period_id_employee_id_key UNIQUE (payroll_period_id, employee_id);


--
-- Name: payroll_items payroll_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_pkey PRIMARY KEY (id);


--
-- Name: payroll_periods payroll_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_periods
    ADD CONSTRAINT payroll_periods_pkey PRIMARY KEY (id);


--
-- Name: payroll_periods payroll_periods_start_date_end_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_periods
    ADD CONSTRAINT payroll_periods_start_date_end_date_key UNIQUE (start_date, end_date);


--
-- Name: work_logs work_logs_employee_id_work_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_employee_id_work_date_key UNIQUE (employee_id, work_date);


--
-- Name: work_logs work_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_pkey PRIMARY KEY (id);


--
-- Name: payroll_items payroll_items_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: payroll_items payroll_items_payroll_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES public.payroll_periods(id);


--
-- Name: work_logs work_logs_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- PostgreSQL database dump complete
--


