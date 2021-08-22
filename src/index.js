'use strict';

const fs = require("fs");

const {ArgumentParser} = require("argparse");
const puppeteer = require("puppeteer-extra");

function loadConfigFile(file_path) {
    if (fs.existsSync(file_path)) {
        try {
            return JSON.parse(fs.readFileSync(file_path, {encoding: 'utf-8'}));
        } catch (error) {
            console.error('Failed to read config file!');
            console.error(error);
            process.exit(1);
        }
    } else {
        console.error('No config file found! Using default values.');
        return {};
    }
}


(async () => {
    const options = [
        {
            name: '--browser-args',
            default: [],
            convert: (x) => {
                return x.split(',').filter(x => x.length > 0);
            }
        },
        {
            name: '--headful',
            default: false,
            argparse: {
                action: 'store_true'
            }
        }
    ]

    // Parse arguments
    const parser = new ArgumentParser();
    parser.add_argument('--config', '-c', {default: 'config.json'});
    for (const option of options){
        if (option['argparse'] === undefined){
            option['argparse'] = {}
        }
        parser.add_argument(option['name'], option['argparse']);
    }
    const args = parser.parse_args();

    // Load config file
    const config = loadConfigFile(args['config']);

    // Override options from arguments and set defaults
    for (const option of options){
        const key = option['name'].replace(/^-+/g, '').replace(/-/g, '_');
        if (config[key] === undefined){
            if (args[key] === undefined) {
                config[key] = option['default'];
            } else {
                const convert = option['convert'];
                if (convert === undefined){
                    config[key] =args[key];
                } else {
                    config[key] = convert(args[key]);
                }
            }
        }
    }

    const browser = await puppeteer.launch({
        headless: !config['headful'],
        args: config['browser_args'],
        defaultViewport: null
    });

    const page = await browser.newPage();

    // Load cookies
    const cookies = JSON.parse(fs.readFileSync('./cookies.json', 'utf-8'));
    await page.setCookie(...cookies);

    await page.goto('https://gaming.amazon.com/home');

    const response = await page.waitForResponse(response => {
        return (response.url().startsWith('https://gaming.amazon.com/graphql?') && JSON.parse(response.request().postData())['operationName'] === 'OffersContext_WithEligibilityAndCode_Offers');
    });
    const primeOffers = (await response.json())['data']['primeOffers'];

    for (const primeOffer of primeOffers){
        console.log(primeOffer['title']);

        if (primeOffer['deliveryMethod'] === 'EXTERNAL_OFFER'){
            await page.goto(primeOffer['content']['externalURL'], {waitUntil: "networkidle0"});

            const claimButtons = await page.$x('//button[@data-a-target="AvailableButton"]');
            if (claimButtons.length === 0){
                console.log('No claim buttons!');
                continue;
            }
            for (const claimButton of claimButtons){

                // Find subtitle
                const lootCardDiv = (await claimButton.$x('./ancestor::div[@data-a-target="loot-card"]'))[0];
                const subtitle = await (await (await lootCardDiv.$x('.//*[@data-a-target="LootCardSubtitle"]'))[0].getProperty('innerText')).jsonValue();
                console.log('\t',subtitle);

                // Sometimes the modal doesn't open if we click too fast
                await page.waitForTimeout(500);

                await claimButtons[0].click();

                // Wait for confirmation modal
                const modal = await page.waitForXPath('//div[@data-a-target="gms-base-modal"]');
                if ((await modal.$x('.//button[@data-a-target="sign-in-button"]')).length > 0){
                    console.error('\t\tUser not signed in!');
                } else if ((await modal.$x('.//*[contains(text(), "Link game account")]')).length > 0){
                    console.error('\t\tAccount not linked!');
                } else if ((await modal.$x('.//*[contains(text(), "Your Amazon Prime account")]')).length > 0){
                    console.error('\t\tAccount not linked!');
                } else if ((await modal.$x('.//*[contains(text(), "Successfully Claimed")]')).length > 0) {
                    console.log('\t\tSuccessfully claimed!');
                } else {
                    console.error('Unknown result!');
                }
                await page.waitForTimeout(500);
                await page.click('button[data-a-target="close-modal-button"]');
            }
        } else if (primeOffer['deliveryMethod'] === 'DIRECT_ENTITLEMENT'){
            console.log('Cant claim these yet!');
        }
    }

})().catch((error) => {
    console.error(error);
    process.exit(1);
});
