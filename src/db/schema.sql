CREATE DATABASE IF NOT EXISTS biometric_dtr;
USE biometric_dtr;

CREATE TABLE IF NOT EXISTS Teachers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    biometric_id INT UNIQUE NOT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS AttendanceLogs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    teacher_id INT NOT NULL,
    log_time DATETIME NOT NULL,
    log_type ENUM('Check-in', 'Check-out') NOT NULL,
    FOREIGN KEY (teacher_id) REFERENCES Teachers(id)
);

CREATE TABLE IF NOT EXISTS Users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS TimeSchedule (
    id INT PRIMARY KEY DEFAULT 1,
    am_time_in TIME NOT NULL DEFAULT '07:00:00',
    am_time_in_end TIME NOT NULL DEFAULT '08:00:00',
    am_time_out_start TIME NOT NULL DEFAULT '12:00:00',
    am_time_out TIME NOT NULL DEFAULT '12:20:00',
    pm_time_in TIME NOT NULL DEFAULT '12:35:00',
    pm_time_in_end TIME NOT NULL DEFAULT '13:00:00',
    pm_time_out_start TIME NOT NULL DEFAULT '17:00:00',
    pm_time_out TIME NOT NULL DEFAULT '18:00:00',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS TeacherTimeSchedule (
    teacher_id INT PRIMARY KEY,
    am_time_in TIME NOT NULL DEFAULT '07:00:00',
    am_time_in_end TIME NOT NULL DEFAULT '08:00:00',
    am_time_out_start TIME NOT NULL DEFAULT '12:00:00',
    am_time_out TIME NOT NULL DEFAULT '12:20:00',
    pm_time_in TIME NOT NULL DEFAULT '12:35:00',
    pm_time_in_end TIME NOT NULL DEFAULT '13:00:00',
    pm_time_out_start TIME NOT NULL DEFAULT '17:00:00',
    pm_time_out TIME NOT NULL DEFAULT '18:00:00',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES Teachers(id) ON DELETE CASCADE
);
