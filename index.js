const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const express = require('express');

// Convert a single HTML file to PDF
/**
 * 
 * @param {*} page 
 * @param {*} url 
 * @param {*} pdfPath 
 */
async function convertHtmlToPdf(page, url, pdfPath, cssContents) {
    console.log(`Converting ${url} to PDF...`);
    await page.goto(url, { waitUntil: 'networkidle0' });

    for (const css of cssContents) {
        await page.evaluate(css => {
            const style = document.createElement('style');
            style.type = 'text/css';
            style.appendChild(document.createTextNode(css));
            document.head.appendChild(style);
        }, css);
    }

    await page.pdf({
        path: pdfPath, 
        format: 'A4', 
        margin: {
            top: '20mm',
            right: '20mm',
            bottom: '20mm',
            left: '20mm'
        }
    });
    console.log(`Successfully converted ${url} to ${pdfPath}`);
}


/**
 * 
 * @param {*} cssFilePaths 
 * @returns 
 */
async function readCssFiles(cssFilePaths) {
    const cssContents = await Promise.all(cssFilePaths.map(path => fs.readFile(path, 'utf-8')));
    return cssContents;
}



/**
 * 
 * @param {*} htmlFiles 
 * @param {*} pdfFiles 
 * @param {*} port 
 * @param {*} directoryPath 
 */
async function convertMultipleHtmlToPdf(htmlFiles, pdfFiles, port, directoryPath, cssContents) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    for (let i = 0; i < htmlFiles.length; i++) {
        const htmlFile = htmlFiles[i];
        const pdfFile = pdfFiles[i];
        const localUrl = `http://localhost:${port}/${path.relative(directoryPath, htmlFile)}`;
        await convertHtmlToPdf(page, localUrl, pdfFile, cssContents);
    }

    await browser.close();
}



/**
 * 
 * @param {*} pdfFiles 
 * @param {*} outputPath 
 */
async function mergePdfs(pdfFiles, outputPath) {
    const mergedPdf = await PDFDocument.create();

    for (const pdfPath of pdfFiles) {
        const pdfBytes = await fs.readFile(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
        copiedPages.forEach((page) => {
            mergedPdf.addPage(page);
        });
    }

    const mergedPdfFile = await mergedPdf.save();
    await fs.writeFile(outputPath, mergedPdfFile);
    console.log(`PDFs merged into ${outputPath}`);
}



/**
 * 
 * @param {*} directoryPath 
 * @returns 
 */
async function getHtmlFilesSortedByDate(directoryPath) {
    const files = await fs.readdir(directoryPath);
    const htmlFiles = files.filter(file => file.endsWith('.html') || file.endsWith('.xhtml'));

    const fileStatPromises = htmlFiles.map(async (file) => {
        const stat = await fs.stat(path.join(directoryPath, file));
        return {
            file,
            mtime: stat.mtime
        };
    });

    const fileStats = await Promise.all(fileStatPromises);

    fileStats.sort((a, b) => a.mtime - b.mtime);

    return fileStats.map(stat => path.join(directoryPath, stat.file));
}



// Convert and merge HTML/XHTML files from a directory
/**
 * 
 * @param {*} directoryPath 
 * @param {*} outputPdf 
 * @returns 
 */
async function convertAndMergeFromDirectory(directoryPath, outputPdf, cssFilePaths = []) {
    // Start an Express server to serve the directory containing HTML and CSS files
    const app = express();
    const port = 3000; // Make sure this port is free
    app.use('/', express.static(directoryPath));
    app.use('/static', express.static(path.join(directoryPath, 'static')));
    app.use('/static/reader', express.static(path.join(directoryPath, 'static', 'reader')));
    const server = app.listen(port);

    console.log(`Reading files from directory: ${directoryPath}`);
    const htmlFiles = await getHtmlFilesSortedByDate(directoryPath);
    if (htmlFiles.length === 0) {
        console.log('No HTML or XHTML files found in the specified directory.');
        return;
    }
    console.log(`Found ${htmlFiles.length} HTML/XHTML files.`);

    // Read css files to inject
    let cssContents = [];
    if (cssFilePaths.length > 0) {
        cssContents = await readCssFiles(cssFilePaths);
    }

    // Create a directory for temporary PDF files if it doesn't exist
    const tempDir = 'temp_pdfs';
    await fs.mkdir(tempDir, { recursive: true });

    const pdfFiles = htmlFiles.map((_, i) => path.join('temp_pdfs', `temp_${i}.pdf`));
    await convertMultipleHtmlToPdf(htmlFiles, pdfFiles, port, directoryPath, cssContents);
    if (pdfFiles.length === 0) {
        console.log('No PDF files generated.');
        return;
    }

    console.log('Merging PDF files...');
    await mergePdfs(pdfFiles, outputPdf);
    console.log(`Successfully merged into ${outputPdf}`);

    // Optional: Delete individual temp PDFs
    // console.log('Cleaning up temporary PDF files...');
    // for (const file of pdfFiles) {
    //   await fs.unlink(file);
    // }
    // console.log('Cleanup complete.');
    server.close();
}




// Main function to execute the script
/**
 * 
 * @returns 
 */
async function main() {
    const argv = require('yargs')
        .usage('Usage: $0 --directory [dir] --output [output] [--css [css1, css2, ...]]')
        .option('directory', { alias: 'd', type: 'string', demandOption: true, describe: 'Directory containing HTML files' })
        .option('output', { alias: 'o', type: 'string', demandOption: true, describe: 'Output PDF file path' })
        .option('css', { alias: 'c', type: 'array', describe: 'CSS files to inject' })
        .help('h')
        .alias('h', 'help')
        .argv;

    if (argv.directory && argv.output) {
        const cssFiles = argv.css || [];
        await convertAndMergeFromDirectory(argv.directory, argv.output, cssFiles);
        console.log(`PDFs from ${argv.directory} merged successfully into ${argv.output}.`);
    }

}

main();