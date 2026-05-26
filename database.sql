-- database.sql
-- Create database if it does not exist
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'AttendanceDB')
BEGIN
    CREATE DATABASE AttendanceDB;
END
GO

USE AttendanceDB;
GO

-- Drop tables if they exist to support clean re-initialization
IF OBJECT_ID('dbo.AttendanceLogs', 'U') IS NOT NULL
    DROP TABLE dbo.AttendanceLogs;
GO

IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL
    DROP TABLE dbo.Users;
GO

IF OBJECT_ID('dbo.Departments', 'U') IS NOT NULL
    DROP TABLE dbo.Departments;
GO

-- 1. Create Departments Table
CREATE TABLE Departments (
    DepartmentID INT IDENTITY(1,1) PRIMARY KEY,
    DepartmentName NVARCHAR(100) UNIQUE NOT NULL
);
GO

-- 2. Create Users Table
CREATE TABLE Users (
    UserID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeNo NVARCHAR(50) UNIQUE NOT NULL,
    FirstName NVARCHAR(100),
    LastName NVARCHAR(100),
    DepartmentID INT FOREIGN KEY REFERENCES Departments(DepartmentID),
    Role NVARCHAR(20) DEFAULT 'User',
    EmpType NVARCHAR(50),
    PasswordHash NVARCHAR(MAX),
    IsActive BIT DEFAULT 1
);
GO

-- 3. Create AttendanceLogs Table
CREATE TABLE AttendanceLogs (
    LogID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeNo NVARCHAR(50) FOREIGN KEY REFERENCES Users(EmployeeNo) ON DELETE CASCADE,
    PunchDateTime DATETIME NOT NULL,
    DeviceName NVARCHAR(100),
    AreaName NVARCHAR(100)
);
GO

-- Seed Initial Departments
INSERT INTO Departments (DepartmentName) VALUES 
('IT'),
('MATERIALS'),
('SUPPLY CHAIN'),
('PROJECTS'),
('MARKETING'),
('EHS'),
('FINANCE'),
('HR'),
('PLANTATION'),
('ADMIN'),
('DMC OFFICE'),
('WOW'),
('PBCoE'),
('MANUFACTURING'),
('CXO'),
('IFIL'),
('QSC'),
('ICOE'),
('RAW MATERIALS'),
('LEGAL'),
('BE CELL'),
('TECHNICAL'),
('LOGISTICS'),
('Corp'),
('SPECIAL PROJECTS');
GO

-- Seed Initial Users (Default credentials matching config/auth.js defaults, hashed with bcrypt)
-- admin / Admin@123 -> $2a$10$4p9NhDyHF1QqR9sgrCj51uc27HkBcUehNkygwN7CFQHvc6QKOvNiG
-- user / User@123 -> $2a$10$frp4tygGGow9cneX7Ugil.KDqvB7Yu3Fhtst87gTAns5HroNSq4fy
INSERT INTO Users (EmployeeNo, FirstName, LastName, DepartmentID, Role, PasswordHash, IsActive) VALUES
('ADMIN001', 'Admin', 'User', 1, 'Admin', '$2a$10$4p9NhDyHF1QqR9sgrCj51uc27HkBcUehNkygwN7CFQHvc6QKOvNiG', 1),
('USER001', 'Standard', 'Employee', 1, 'User', '$2a$10$frp4tygGGow9cneX7Ugil.KDqvB7Yu3Fhtst87gTAns5HroNSq4fy', 1);

GO
